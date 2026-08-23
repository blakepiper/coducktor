// ---- conversation runtime --------------------------------------------------------------------
// The conversation-first cockpit's engine path. It is deliberately separate from the workflow
// `RunManager` wiring above: nothing here consults workflows, markers, variants, quota routing, or
// context refresh, and one ordinary user submission is always exactly one provider turn.

/// Bounds on skill attachments for one message. Skills are prompt attachments, so they share the
/// spirit of the existing prompt bounds: enough for a real working set, small enough that a
/// mistaken selection cannot silently dominate a turn's context.
const MAX_ATTACHED_SKILLS: usize = 8;
const MAX_ATTACHED_SKILL_BYTES: usize = 128 * 1024;

/// Conversation ids are only unique within their own project, so every process-wide registry the
/// conversation runtime keeps is keyed by the pair. Two projects that both hold `chat-1` therefore
/// address different workers, cancellation tokens, and live topics.
type ConversationKey = (String, String);

#[derive(Clone)]
struct ProjectConversations {
    root: PathBuf,
    manager: Arc<RunManagerMutex<ConversationManager>>,
}

/// Runs admitted conversation turns to completion on their own worker threads, entirely outside
/// the conversation manager's lock. `ConversationManager::admit_next` stops before
/// `ConversationSessionFactory::open`, so this is the only place production code opens a harness
/// session or calls `turn`/`answer`.
#[derive(Clone)]
struct ConversationDispatch {
    project_id: String,
    manager: Arc<RunManagerMutex<ConversationManager>>,
    factory: Arc<dyn ConversationSessionFactory>,
    workers: Arc<Mutex<BTreeMap<ConversationKey, std::thread::JoinHandle<()>>>>,
}

impl ConversationDispatch {
    fn key(&self, conversation_id: &str) -> ConversationKey {
        (self.project_id.clone(), conversation_id.to_owned())
    }

    /// Admit and spawn every turn the manager will currently allow. Cheap and a no-op when nothing
    /// is queued, so every settlement point can call it unconditionally.
    fn pump(&self) {
        self.reap_finished();
        loop {
            let admitted = match self.manager.lock().admit_next() {
                Ok(Some(admitted)) => admitted,
                Ok(None) => return,
                Err(error) => {
                    eprintln!("coducktor: could not admit a conversation turn: {error}");
                    return;
                }
            };
            self.spawn(admitted);
        }
    }

    /// Join and drop every worker handle that has already finished. A worker cannot safely remove
    /// its own key — a redispatch it triggers can already have inserted a new handle there — so
    /// every dispatch point sweeps instead.
    fn reap_finished(&self) {
        reap_finished_conversation_workers(&self.workers);
    }

    /// An admitted turn is already durably `running` and may already own a parked native session,
    /// so a failed thread spawn cannot simply report an error by id — the turn must be settled
    /// here or it stays active forever with no worker behind it. It is held in a cell reachable
    /// from both the closure and this call so whichever one actually runs (never both) takes it.
    fn spawn(&self, admitted: AdmittedConversationTurn) {
        let key = self.key(&admitted.request.conversation_id);
        let cell = Arc::new(Mutex::new(Some(admitted)));
        let dispatch = self.clone();
        let thread_cell = cell.clone();
        let spawned = std::thread::Builder::new()
            .name("coducktor-conversation".to_owned())
            .spawn(move || {
                if let Some(admitted) = thread_cell.lock().ok().and_then(|mut cell| cell.take()) {
                    dispatch.run(admitted);
                }
            });
        match spawned {
            Ok(handle) => {
                if let Ok(mut workers) = self.workers.lock() {
                    workers.insert(key, handle);
                }
            }
            Err(error) => {
                let admitted = cell.lock().ok().and_then(|mut cell| cell.take());
                if let Some(admitted) = admitted {
                    let _ = self.manager.lock().apply_open_failure(
                        admitted,
                        format!("could not start the agent worker: {error}"),
                    );
                }
            }
        }
    }

    /// One admitted turn: open or reuse the native session, run exactly one provider turn, apply
    /// the outcome, then apply this conversation's own post-turn Git policy.
    fn run(&self, mut admitted: AdmittedConversationTurn) {
        let request = admitted.request.clone();
        if !admitted.has_live_session() {
            match self.factory.open(&request) {
                Ok(session) => admitted.attach_session(session),
                Err(reason) => {
                    // Bound before `settle`: a guard produced inline would live until the end of
                    // the whole statement, and `settle` takes the same lock again.
                    let applied = self.manager.lock().apply_open_failure(admitted, reason);
                    self.settle(applied);
                    return;
                }
            }
        }
        let outcome = match admitted.session_mut() {
            Some(session) => session.turn(&request, &mut |event| {
                self.apply_event(&request.conversation_id, &request.turn_id, event)
            }),
            None => Err("the conversation session was lost before its turn".to_owned()),
        };
        let applied = self.manager.lock().apply_turn_result(admitted, outcome);
        self.settle(applied);
    }

    /// Continue an in-progress turn by answering one exact native question. This never counts as a
    /// new ordinary turn: the same session and the same turn id carry through.
    fn run_answer(&self, mut pending: PendingConversationAnswer) {
        let conversation_id = pending.conversation_id.clone();
        let turn_id = pending.turn_id.clone();
        let request_id = pending.request_id.clone();
        let answers = pending.answers.clone();
        let cancellation = pending.cancellation();
        let outcome = pending.session_mut().answer(
            &request_id,
            &answers,
            &cancellation,
            &mut |event| self.apply_event(&conversation_id, &turn_id, event),
        );
        let applied = self.manager.lock().apply_answer_result(pending, outcome);
        self.settle(applied);
    }

    /// Applied under a fresh, brief lock per event — never the lock the provider I/O between
    /// events runs under.
    fn apply_event(
        &self,
        conversation_id: &str,
        turn_id: &str,
        event: ConversationEventInput,
    ) -> std::io::Result<()> {
        self.manager
            .lock()
            .apply_turn_event(conversation_id, turn_id, event)
            .map(|_| ())
    }

    /// Apply post-turn Git policy for a settled turn, then admit whatever this turn's completion
    /// freed capacity for.
    fn settle(&self, applied: std::io::Result<ConversationRecord>) {
        match applied {
            Ok(record) => self.apply_git_policy(&record),
            Err(error) => eprintln!("coducktor: could not apply a conversation turn result: {error}"),
        }
        self.pump();
    }

    /// Automatic Git runs only for a managed worktree, only after a turn that ended normally, and
    /// never through a model: the commit subject is derived locally from the user's own message.
    /// A Git failure is reported as turn activity and leaves the conversation idle.
    fn apply_git_policy(&self, record: &ConversationRecord) {
        if record.git_mode != ConversationGitMode::Auto || record.state != ConversationState::Idle {
            return;
        }
        let (Some(worktree), Some(turn)) = (record.worktree_path.as_deref(), record.latest_turn.as_ref())
        else {
            return;
        };
        if turn.state != TurnState::Ended {
            return;
        }
        let worktree = PathBuf::from(worktree);
        let turn_id = turn.id.clone();
        let message = self.turn_message(&record.id, &turn_id, record);
        for event in auto_git_after_turn(&worktree, &message) {
            if let Err(error) = self
                .manager
                .lock()
                .record_git_activity(&record.id, &turn_id, event)
            {
                eprintln!("coducktor: could not record Git activity: {error}");
                return;
            }
        }
    }

    /// The exact user text that opened this turn, for the deterministic commit subject. The
    /// durable history is the source of truth; the initial message is the fallback for a
    /// conversation whose transcript could not be read.
    fn turn_message(
        &self,
        conversation_id: &str,
        turn_id: &str,
        record: &ConversationRecord,
    ) -> String {
        self.manager
            .lock()
            .read_history(conversation_id)
            .iter()
            .rev()
            .find(|event| {
                event.event_type == "user-message"
                    && event.extra.get("turnId").and_then(Value::as_str) == Some(turn_id)
            })
            .and_then(|event| event.extra.get("text").and_then(Value::as_str))
            .map(str::to_owned)
            .unwrap_or_else(|| record.initial_message.text.clone())
    }
}

/// Perform one automatic post-turn commit and push, returning the activity to attach to the turn.
/// Every Git call is an argument array run with prompts disabled, so an unattended commit or push
/// can never block on the user's terminal.
fn auto_git_after_turn(worktree: &Path, user_message: &str) -> Vec<ConversationEventInput> {
    let mut activity = Vec::new();
    let dirty = git_capture(worktree, &["status", "--porcelain"])
        .map(|status| !status.trim().is_empty())
        .unwrap_or(false);
    if dirty {
        let subject = coducktor_core::conversations::git::auto_commit_subject(user_message);
        match commit_all(worktree, &subject) {
            Ok(sha) => activity.push(
                ConversationEventInput::new("git.committed")
                    .field("subject", &subject)
                    .field("sha", sha),
            ),
            Err(reason) => {
                activity.push(
                    ConversationEventInput::new("git.failed")
                        .field("action", "commit")
                        .field("message", reason),
                );
                // Pushing a branch whose commit just failed would publish a stale head under a
                // label that claims the turn was saved.
                return activity;
            }
        }
    }
    match push_current_branch(worktree) {
        Ok(pushed) => activity.push(
            ConversationEventInput::new("git.pushed")
                .field("branch", pushed.branch)
                .field("remote", pushed.remote)
                .field("upstreamSet", pushed.upstream_set),
        ),
        Err(reason) => activity.push(
            ConversationEventInput::new("git.failed")
                .field("action", "push")
                .field("message", reason),
        ),
    }
    activity
}

impl InProcessEngine {
    /// Open (or reuse) the conversation manager for a scope's project. Managers are lazy for the
    /// same reason run managers are: a workspace can register many projects the user never opens.
    fn project_conversations(&self, scope: &Scope) -> Result<ProjectConversations, EngineError> {
        let entry = self.project_manager(scope)?;
        let project_id = match scope {
            Scope::Project(id) if id != "default" => id.clone(),
            Scope::Workspace | Scope::Project(_) => self.boot_project_id.clone(),
        };
        let mut managers = self.conversations.lock().map_err(|_| lock_err())?;
        if let Some(open) = managers.get(&project_id)
            && same_project_root(&open.root, &entry.root)
        {
            return Ok(open.clone());
        }
        let manager = ConversationManager::open_with_options(
            self.project_data_dir(&entry.root),
            ConversationManagerOptions {
                max_parallel: self.loaded_workspace_config().resources.max_parallel.max(1) as usize,
            },
        );
        let manager = Arc::new(RunManagerMutex::new(manager));
        self.wire_conversations(&project_id, &manager);
        let open = ProjectConversations {
            root: entry.root,
            manager,
        };
        managers.insert(project_id, open.clone());
        Ok(open)
    }

    /// Publish one project's conversation records and history onto the live topics screens
    /// already subscribe to, so a conversation tails exactly like a task does.
    fn wire_conversations(
        &self,
        project_id: &str,
        manager: &Arc<RunManagerMutex<ConversationManager>>,
    ) {
        let event_topics = self.live_event_topics.clone();
        let event_project = project_id.to_owned();
        let record_topics = self.live_event_topics.clone();
        let record_project = project_id.to_owned();
        let mut guard = manager.lock();
        guard.subscribe_events(move |notification| {
            publish_live_event(
                &event_topics,
                &format!("run:{event_project}:{}", notification.conversation_id),
                json!({
                    "type": "run-event",
                    "projectId": event_project,
                    "event": notification.event
                }),
            );
        });
        guard.subscribe_conversations(move |record| {
            let data = json!({
                "type": "conversation",
                "projectId": record_project,
                "conversation": record
            });
            publish_live_event(
                &record_topics,
                &format!("run:{record_project}:{}", record.id),
                data.clone(),
            );
            publish_live_event(&record_topics, "workspace", data);
        });
    }

    fn conversation_dispatch(&self, scope: &Scope) -> Result<ConversationDispatch, EngineError> {
        let entry = self.project_conversations(scope)?;
        Ok(ConversationDispatch {
            project_id: self.scoped_project_id(scope),
            manager: entry.manager,
            factory: self.conversation_factory.clone(),
            workers: self.conversation_workers.clone(),
        })
    }

    fn scoped_project_id(&self, scope: &Scope) -> String {
        match scope {
            Scope::Project(id) if id != "default" => id.clone(),
            Scope::Workspace | Scope::Project(_) => self.boot_project_id.clone(),
        }
    }

    // ---- conversation reads --------------------------------------------------------------

    pub async fn list_conversations(
        &self,
        scope: &Scope,
    ) -> Result<Vec<ConversationRecord>, EngineError> {
        let entry = self.project_conversations(scope)?;
        let manager = entry.manager.lock();
        Ok(manager.list().into_iter().cloned().collect())
    }

    pub async fn get_conversation(
        &self,
        scope: &Scope,
        conversation_id: &str,
    ) -> Result<ConversationRecord, EngineError> {
        let entry = self.project_conversations(scope)?;
        let manager = entry.manager.lock();
        manager.get(conversation_id).cloned().ok_or(EngineError::NotFound)
    }

    /// Project-qualified browser rows across every project this workspace can reach. Conversation
    /// ids are only unique per project, so each row carries the project that owns it.
    pub async fn conversations_index(&self) -> Result<ConversationsIndexResponse, EngineError> {
        let projects = self.projects().await?;
        let mut scopes = projects
            .projects
            .iter()
            .map(|project| (project.id.clone(), Scope::Project(project.id.clone())))
            .collect::<Vec<_>>();
        // The default single-repository case never registers itself, so the boot project would
        // otherwise have no row at all in its own browser.
        if !scopes.iter().any(|(id, _)| id == &self.boot_project_id) {
            scopes.push((self.boot_project_id.clone(), Scope::Workspace));
        }
        let mut conversations = Vec::new();
        for (project_id, scope) in scopes {
            let Ok(entry) = self.project_conversations(&scope) else {
                // A project whose checkout is missing degrades to absent rows, never a failed
                // browser.
                continue;
            };
            let manager = entry.manager.lock();
            conversations.extend(
                manager
                    .list()
                    .into_iter()
                    .map(|record| conversation_index_entry(&project_id, record)),
            );
        }
        conversations.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        Ok(ConversationsIndexResponse {
            conversations,
            extra: Default::default(),
        })
    }

    pub async fn conversation_history(
        &self,
        scope: &Scope,
        conversation_id: &str,
        cursor: Option<&str>,
    ) -> Result<RunHistoryPage, EngineError> {
        let scoped = self.scoped(scope)?;
        let _ = scoped.get_conversation(scope, conversation_id).await?;
        scoped.read_history_page(conversation_id, cursor)
    }

    // ---- conversation writes -------------------------------------------------------------

    /// Create a conversation and durably queue its exact first user turn. No provider process is
    /// opened here: screens install their live subscription and then call `activate_conversations`.
    pub async fn create_conversation(
        &self,
        scope: &Scope,
        input: CreateConversationInput,
    ) -> Result<CreateConversationResponse, EngineError> {
        let entry = self.project_conversations(scope)?;
        let project_id = self.scoped_project_id(scope);
        let attachments = self.resolve_skill_attachments(&entry.root, &input.skills)?;
        let base_branch = input.base_branch.clone().or_else(|| {
            coducktor_core::git::worktree::resolve_base_ref(&entry.root, "HEAD")
        });
        if input.git_mode == ConversationGitMode::Auto && !input.worktree {
            return Err(EngineError::Conflict {
                reason: "automatic Git mode requires a managed worktree".to_owned(),
            });
        }
        let created = {
            let mut manager = entry.manager.lock();
            manager
                .create(NewConversation {
                    project_id,
                    text: input.text,
                    images: input.images,
                    skill_attachments: attachments,
                    harness: input.harness,
                    model: input.model,
                    reasoning: input.reasoning,
                    repository_root: entry.root.clone(),
                    cwd: entry.root.clone(),
                    base_branch: base_branch.clone(),
                    branch: None,
                    worktree: input.worktree,
                    worktree_path: None,
                    git_mode: input.git_mode,
                })
                .map_err(conversation_err)?
        };
        if !input.worktree {
            return Ok(CreateConversationResponse {
                conversation: created,
            });
        }
        // Placement is resolved before the first turn can be admitted, so the provider only ever
        // sees a cwd that already exists.
        let base = base_branch.unwrap_or_else(|| "HEAD".to_owned());
        match coducktor_core::git::worktree::create_worktree(&entry.root, &created.id, &base) {
            Ok(info) => {
                let mut manager = entry.manager.lock();
                let placed = manager
                    .place_worktree(&created.id, Path::new(&info.path), &info.branch, &info.base_branch)
                    .map_err(conversation_err)?;
                Ok(CreateConversationResponse {
                    conversation: placed,
                })
            }
            Err(reason) => {
                let mut manager = entry.manager.lock();
                let _ = manager.cancel(&created.id);
                let _ = manager.delete(&created.id);
                Err(EngineError::Conflict { reason })
            }
        }
    }

    /// Queue exactly one ordinary follow-up turn. Refused while a turn is active — the composer
    /// keeps the draft rather than silently queueing a second provider call.
    pub async fn submit_conversation_message(
        &self,
        scope: &Scope,
        conversation_id: &str,
        input: SubmitConversationMessageInput,
    ) -> Result<SubmitConversationMessageResponse, EngineError> {
        let entry = self.project_conversations(scope)?;
        let attachments = self.resolve_skill_attachments(&entry.root, &input.skills)?;
        let turn = {
            let mut manager = entry.manager.lock();
            manager
                .submit_message(
                    conversation_id,
                    ConversationMessage {
                        text: input.text,
                        images: input.images,
                        skill_attachments: attachments,
                        extra: Default::default(),
                    },
                )
                .map_err(conversation_err)?
        };
        self.activate_conversations(scope)?;
        Ok(SubmitConversationMessageResponse {
            accepted: true,
            turn,
        })
    }

    /// Answer one native question inside the turn that asked it. This continues the same provider
    /// turn and never counts as a new ordinary submission.
    pub async fn answer_conversation_question(
        &self,
        scope: &Scope,
        conversation_id: &str,
        input: AnswerConversationQuestionInput,
    ) -> Result<AnswerConversationQuestionResponse, EngineError> {
        let dispatch = self.conversation_dispatch(scope)?;
        let pending = {
            let mut manager = dispatch.manager.lock();
            manager
                .begin_answer(conversation_id, &input.request_id, input.answers)
                .map_err(conversation_err)?
        };
        let turn = {
            let manager = dispatch.manager.lock();
            manager
                .get(conversation_id)
                .and_then(|record| record.active_turn.clone())
                .ok_or(EngineError::NotFound)?
        };
        let key = dispatch.key(conversation_id);
        let worker = dispatch.clone();
        let spawned = std::thread::Builder::new()
            .name("coducktor-conversation-answer".to_owned())
            .spawn(move || worker.run_answer(pending));
        match spawned {
            Ok(handle) => {
                if let Ok(mut workers) = self.conversation_workers.lock() {
                    workers.insert(key, handle);
                }
                Ok(AnswerConversationQuestionResponse {
                    accepted: true,
                    turn,
                })
            }
            Err(error) => Err(EngineError::Unavailable {
                reason: format!("could not start the agent worker: {error}"),
            }),
        }
    }

    /// Cancel the active turn. A queued turn is cancelled without ever opening a provider; a
    /// parked question's session is torn down outside the manager lock.
    pub async fn cancel_conversation_turn(
        &self,
        scope: &Scope,
        conversation_id: &str,
    ) -> Result<CancelConversationTurnResponse, EngineError> {
        let entry = self.project_conversations(scope)?;
        let turn_id = {
            let manager = entry.manager.lock();
            manager
                .get(conversation_id)
                .and_then(|record| record.active_turn.as_ref().map(|turn| turn.id.clone()))
        };
        let cancellation = {
            let mut manager = entry.manager.lock();
            manager.cancel(conversation_id).map_err(conversation_err)?
        };
        if let Some(mut session) = cancellation.session_to_cancel {
            session.cancel();
        }
        Ok(CancelConversationTurnResponse {
            cancelled: cancellation.cancelled,
            turn_id: cancellation.cancelled.then_some(turn_id).flatten(),
        })
    }

    pub async fn archive_conversation(
        &self,
        scope: &Scope,
        conversation_id: &str,
        archived: bool,
    ) -> Result<ConversationRecord, EngineError> {
        let entry = self.project_conversations(scope)?;
        let mut manager = entry.manager.lock();
        manager
            .archive(conversation_id, archived)
            .map_err(conversation_err)
    }

    pub async fn read_conversation(
        &self,
        scope: &Scope,
        conversation_id: &str,
        seen: bool,
    ) -> Result<ConversationRecord, EngineError> {
        let entry = self.project_conversations(scope)?;
        let mut manager = entry.manager.lock();
        manager
            .mark_seen(conversation_id, seen)
            .map_err(conversation_err)
    }

    /// Delete a conversation, its transcript, and — when it owned one — its managed worktree and
    /// branch. Git reclamation is best effort and reported, never silent.
    pub async fn delete_conversation(
        &self,
        scope: &Scope,
        conversation_id: &str,
    ) -> Result<DeleteConversationResponse, EngineError> {
        let entry = self.project_conversations(scope)?;
        let record = {
            let manager = entry.manager.lock();
            manager.get(conversation_id).cloned()
        };
        let Some(record) = record else {
            return Ok(DeleteConversationResponse {
                deleted: false,
                worktree_removed: false,
                branch_removed: false,
                warnings: Vec::new(),
            });
        };
        let deleted = {
            let mut manager = entry.manager.lock();
            manager.delete(conversation_id).map_err(conversation_err)?
        };
        let mut warnings = Vec::new();
        let mut worktree_removed = false;
        if deleted && let Some(path) = record.worktree_path.as_deref() {
            let path = PathBuf::from(path);
            coducktor_core::git::worktree::remove_worktree(
                &entry.root,
                &path,
                record.branch.as_deref(),
            );
            worktree_removed = !path.exists();
            if !worktree_removed {
                warnings.push(format!(
                    "the managed worktree at {} could not be reclaimed",
                    path.display()
                ));
            }
        }
        Ok(DeleteConversationResponse {
            deleted,
            worktree_removed,
            branch_removed: worktree_removed && record.branch.is_some(),
            warnings,
        })
    }

    pub async fn update_conversation_git_mode(
        &self,
        scope: &Scope,
        conversation_id: &str,
        input: UpdateConversationGitModeInput,
    ) -> Result<UpdateConversationGitModeResponse, EngineError> {
        let entry = self.project_conversations(scope)?;
        let mut manager = entry.manager.lock();
        let updated = manager
            .set_git_mode(conversation_id, input.git_mode)
            .map_err(conversation_err)?;
        Ok(UpdateConversationGitModeResponse {
            updated: true,
            git_mode: updated.git_mode,
        })
    }

    /// Start the queued conversation turns for a project on worker threads. Separate from creation
    /// for the same reason `activate_runs` is: a screen installs its live subscription first, so
    /// no event is emitted into a topic nobody is listening on yet.
    pub fn activate_conversations(&self, scope: &Scope) -> Result<(), EngineError> {
        self.conversation_dispatch(scope)?.pump();
        Ok(())
    }

    /// Resolve selected skills against the project's real skill catalog at submission time. A
    /// selection that has disappeared rejects the send by name, so the composer can preserve the
    /// draft and say what is missing.
    fn resolve_skill_attachments(
        &self,
        root: &Path,
        selections: &[ConversationSkillSelection],
    ) -> Result<Vec<ConversationSkillAttachment>, EngineError> {
        if selections.is_empty() {
            return Ok(Vec::new());
        }
        if selections.len() > MAX_ATTACHED_SKILLS {
            return Err(EngineError::Conflict {
                reason: format!(
                    "at most {MAX_ATTACHED_SKILLS} skills can be attached to one message"
                ),
            });
        }
        let available = discover_skills(root, &ProcessEnv);
        let mut attachments = Vec::with_capacity(selections.len());
        let mut total_bytes = 0usize;
        for selection in selections {
            let skill = available
                .iter()
                .find(|skill| skill.name == selection.id)
                .ok_or_else(|| EngineError::Conflict {
                    reason: format!("skill \"{}\" is no longer available", selection.id),
                })?;
            total_bytes += skill.body.len();
            if total_bytes > MAX_ATTACHED_SKILL_BYTES {
                return Err(EngineError::Conflict {
                    reason: format!(
                        "attached skills exceed the {MAX_ATTACHED_SKILL_BYTES}-byte limit for one message"
                    ),
                });
            }
            attachments.push(ConversationSkillAttachment {
                id: skill.name.clone(),
                name: skill.name.clone(),
                source: skill.source,
                path: skill.path.clone(),
                content_hash: content_hash(&skill.body),
                extra: Default::default(),
            });
        }
        Ok(attachments)
    }
}

/// Project a durable record onto the browser row shape. Shared with the TUI so a project-scoped
/// list and the workspace index cannot drift into two different previews of the same chat.
pub fn conversation_index_entry(
    project_id: &str,
    record: &ConversationRecord,
) -> ConversationIndexEntry {
    ConversationIndexEntry {
        project_id: project_id.to_owned(),
        id: record.id.clone(),
        title: record.title.clone(),
        state: record.state,
        harness: record.harness,
        model: record.model.clone(),
        reasoning: record.reasoning.clone(),
        created_at: record.created_at.clone(),
        updated_at: record.updated_at.clone(),
        seen_at: record.seen_at.clone(),
        archived: record.archived,
        archived_at: record.archived_at.clone(),
        prompt_preview: prompt_preview(&record.initial_message.text).unwrap_or_default(),
        branch: record.branch.clone(),
        pull_request_url: None,
        referenced_pull_request_url: None,
        extra: Default::default(),
    }
}

/// Stable identity for the exact skill body attached to a message, so a transcript can prove what
/// was sent even after the file on disk changes.
fn content_hash(body: &str) -> String {
    // FNV-1a: no dependency, and this is an equality fingerprint, not a security boundary.
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in body.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("fnv1a64:{hash:016x}")
}

/// Map a conversation manager error onto the engine seam's vocabulary. `WouldBlock` is the
/// manager's "there is already an active turn", which is a conflict, not a transport failure.
fn conversation_err(error: std::io::Error) -> EngineError {
    match error.kind() {
        std::io::ErrorKind::NotFound => EngineError::NotFound,
        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::InvalidInput => {
            EngineError::Conflict {
                reason: error.to_string(),
            }
        }
        _ => EngineError::Unavailable {
            reason: error.to_string(),
        },
    }
}

/// Join and drop every conversation worker handle that has already finished. Safe from any
/// dispatch point: a worker only finishes after durably applying its own outcome.
fn reap_finished_conversation_workers(
    workers: &Arc<Mutex<BTreeMap<ConversationKey, std::thread::JoinHandle<()>>>>,
) {
    let Ok(mut workers) = workers.lock() else {
        return;
    };
    let finished = workers
        .iter()
        .filter(|(_, worker)| worker.is_finished())
        .map(|(key, _)| key.clone())
        .collect::<Vec<_>>();
    for key in finished {
        if let Some(worker) = workers.remove(&key) {
            let _ = worker.join();
        }
    }
}
