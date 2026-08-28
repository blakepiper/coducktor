use async_trait::async_trait;
use coducktor_contract::{
    AgentAccountDetailsResponse, AgentAccountStatusResponse, AgentConfigFileContent,
    AgentConfigListing, AgentProfileResponse, AgentProfileSelectionsResponse,
    AgentProfilesResponse, ApiRun, ArchiveFinishedResponse, ChangesPayload, ConfigResponse,
    CreateAgentProfileInput, CreatePrResponse, DeleteRunResponse, GitCommitInput,
    GitCommitResponse, GitPushResponse, GithubChecksData, GithubCommentsData, GithubData,
    GithubMergeInput, GithubMergeResponse, GithubPrChangesData, GithubPrMergeStateResponse,
    GithubRefStatusData, HealthResponse, IdeDirectoryResponse, IdeFileResponse,
    MarkAllReadResponse, OpenAgentAccountFileInput, OpenAgentAccountFileResponse, OpenInInput,
    OpenProjectInResponse, OpenTargetsResponse, ProjectsResponse, ProviderConnectInput,
    ProviderConnectResponse, ProviderStatusResponse, ReclaimWorktreesResponse,
    RegisterProjectInput, RegisterProjectResponse, RemoveAgentProfileResponse,
    RemoveProjectResponse, RemoveWorktreeResponse, RepoBranchRequest, RepoBranchResponse,
    RepoCommitPayload, RepoResponse, RunCommitsResponse, RunHistoryContext, RunHistoryPage, Runner,
    RunnerModelCatalogResponse, RunsIndexResponse, Scratchpad, SelectAgentProfileInput,
    SetAgentConfigInput, SetConfigInput, SetScratchpadInput, SetWorkspaceConfigInput,
    SetWorkspaceUiStateInput, Skill, UiState, UpdateAgentProfileInput, UpdateProjectInput,
    UpdateProjectResponse, WorkspaceConfigResponse, WorkspaceUiState, WorkspaceUsageResponse,
    WorktreeEntry, WorktreesResponse,
};
use coducktor_contract::{
    AnswerConversationQuestionInput, AnswerConversationQuestionResponse,
    ArchiveConversationResponse, CancelConversationTurnResponse, ConversationRecord,
    ConversationsIndexResponse, CreateConversationInput, CreateConversationResponse,
    DeleteConversationResponse, RestartConversationSessionResponse, SubmitConversationMessageInput,
    SubmitConversationMessageResponse, UnarchiveConversationResponse,
    UpdateConversationGitModeInput, UpdateConversationGitModeResponse,
};
use futures_core::stream::BoxStream;
use serde_json::Value;

use crate::error::EngineError;
use crate::events::EngineEvent;
use crate::in_process::InProcessEngine;
use crate::scope::Scope;

/// Demand-driven live topics exposed to screens.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Topic {
    Health,
    Run { project: String, id: String },
    Named(String),
}

/// The only backend seam the terminal UI is allowed to import.
#[async_trait]
pub trait Engine: Send + Sync {
    async fn health(&self) -> Result<HealthResponse, EngineError>;
    async fn list_runs(&self, scope: &Scope) -> Result<Vec<ApiRun>, EngineError>;
    async fn get_run(&self, scope: &Scope, run_id: &str) -> Result<ApiRun, EngineError>;
    async fn archive_run(
        &self,
        scope: &Scope,
        run_id: &str,
        archived: bool,
    ) -> Result<ApiRun, EngineError>;
    async fn delete_run(
        &self,
        scope: &Scope,
        run_id: &str,
    ) -> Result<DeleteRunResponse, EngineError>;
    async fn read_run(&self, scope: &Scope, run_id: &str) -> Result<ApiRun, EngineError>;
    async fn unread_run(&self, scope: &Scope, run_id: &str) -> Result<ApiRun, EngineError>;
    async fn archive_finished(&self, scope: &Scope)
    -> Result<ArchiveFinishedResponse, EngineError>;
    async fn mark_all_read(&self, scope: &Scope) -> Result<MarkAllReadResponse, EngineError>;
    async fn runs_index(&self) -> Result<RunsIndexResponse, EngineError>;
    async fn skills(&self, scope: &Scope) -> Result<Vec<Skill>, EngineError>;
    async fn projects(&self) -> Result<ProjectsResponse, EngineError>;
    async fn register_project(
        &self,
        input: &RegisterProjectInput,
    ) -> Result<RegisterProjectResponse, EngineError>;
    async fn workspace_config(&self) -> Result<WorkspaceConfigResponse, EngineError>;
    async fn workspace_usage(&self) -> Result<WorkspaceUsageResponse, EngineError>;
    async fn config(&self, scope: &Scope) -> Result<ConfigResponse, EngineError>;
    async fn put_config(
        &self,
        scope: &Scope,
        input: &SetConfigInput,
    ) -> Result<ConfigResponse, EngineError>;
    async fn provider_status(&self) -> Result<ProviderStatusResponse, EngineError>;
    async fn connect_provider(
        &self,
        input: &ProviderConnectInput,
    ) -> Result<ProviderConnectResponse, EngineError>;
    async fn models(&self, runner: Runner) -> Result<RunnerModelCatalogResponse, EngineError>;
    async fn github(&self, scope: &Scope) -> Result<GithubData, EngineError>;

    // ---- GitHub detail reads ---------------------------------------------------------------
    /// Return one status glyph per PR number.
    async fn github_checks(
        &self,
        scope: &Scope,
        prs: &[String],
    ) -> Result<GithubChecksData, EngineError>;
    /// Return reference status (draft/review/checks/merged…) per PR or issue.
    async fn github_ref_status(
        &self,
        scope: &Scope,
        prs: &[String],
        issues: &[String],
    ) -> Result<GithubRefStatusData, EngineError>;
    /// Return comment and timeline detail for one GitHub item.
    async fn github_comments(
        &self,
        scope: &Scope,
        kind: &str,
        number: u64,
    ) -> Result<GithubCommentsData, EngineError>;
    /// Return the PR merge gate, checks, and eligibility.
    async fn github_pr_merge_state(
        &self,
        scope: &Scope,
        number: u64,
    ) -> Result<GithubPrMergeStateResponse, EngineError>;
    /// Merge a PR with an explicit method and expected head SHA.
    async fn github_merge_pr(
        &self,
        scope: &Scope,
        number: u64,
        input: &GithubMergeInput,
    ) -> Result<GithubMergeResponse, EngineError>;
    /// Return a PR's file diff for the Changes tab.
    async fn github_pr_changes(
        &self,
        scope: &Scope,
        number: u64,
    ) -> Result<GithubPrChangesData, EngineError>;

    async fn agent_profiles(&self) -> Result<AgentProfilesResponse, EngineError>;
    async fn ui_state(&self, scope: &Scope) -> Result<UiState, EngineError>;
    async fn put_ui_state(&self, scope: &Scope, state: &UiState) -> Result<UiState, EngineError>;
    async fn scratchpad(&self, scope: &Scope) -> Result<Scratchpad, EngineError>;
    async fn put_scratchpad(
        &self,
        scope: &Scope,
        input: &SetScratchpadInput,
    ) -> Result<Scratchpad, EngineError>;

    // ---- task thread ----------------------------------------------------------------------
    async fn run_history(
        &self,
        scope: &Scope,
        run_id: &str,
        cursor: Option<&str>,
    ) -> Result<RunHistoryPage, EngineError>;
    async fn run_history_context(
        &self,
        scope: &Scope,
        run_id: &str,
    ) -> Result<RunHistoryContext, EngineError>;
    async fn open_in(
        &self,
        scope: &Scope,
        run_id: &str,
        input: OpenInInput,
    ) -> Result<Value, EngineError>;
    async fn git_commit(
        &self,
        scope: &Scope,
        run_id: &str,
        input: GitCommitInput,
    ) -> Result<GitCommitResponse, EngineError>;
    async fn git_push(&self, scope: &Scope, run_id: &str) -> Result<GitPushResponse, EngineError>;
    async fn run_commits(
        &self,
        scope: &Scope,
        run_id: &str,
    ) -> Result<RunCommitsResponse, EngineError>;
    async fn create_pr(&self, scope: &Scope, run_id: &str)
    -> Result<CreatePrResponse, EngineError>;

    // ---- diff engine: task git, repo git, compare ------------------------------------------
    async fn run_diff_text(&self, scope: &Scope, run_id: &str) -> Result<String, EngineError>;
    async fn run_changes(&self, scope: &Scope, run_id: &str)
    -> Result<ChangesPayload, EngineError>;
    async fn run_commit(
        &self,
        scope: &Scope,
        run_id: &str,
        sha: &str,
    ) -> Result<RepoCommitPayload, EngineError>;
    async fn run_files(
        &self,
        scope: &Scope,
        run_id: &str,
        path: Option<&str>,
    ) -> Result<WorktreeEntry, EngineError>;
    async fn run_file_raw(
        &self,
        scope: &Scope,
        run_id: &str,
        path: &str,
    ) -> Result<Vec<u8>, EngineError>;
    async fn repo(&self, scope: &Scope) -> Result<RepoResponse, EngineError>;
    async fn repo_changes(&self, scope: &Scope) -> Result<ChangesPayload, EngineError>;
    async fn repo_commit(&self, scope: &Scope, sha: &str)
    -> Result<RepoCommitPayload, EngineError>;
    async fn repo_branch(
        &self,
        scope: &Scope,
        input: &RepoBranchRequest,
    ) -> Result<RepoBranchResponse, EngineError>;

    // ---- conversations ----------------------------------------------------------------------
    // The conversation-first cockpit. One ordinary submission is exactly one provider turn:
    // nothing on this seam sends an automatic continuation, a completion-marker repair, or a
    // workflow transition.

    /// Every conversation in one project, most recently updated first.
    async fn list_conversations(
        &self,
        scope: &Scope,
    ) -> Result<Vec<ConversationRecord>, EngineError>;
    /// One conversation's durable record.
    async fn get_conversation(
        &self,
        scope: &Scope,
        conversation_id: &str,
    ) -> Result<ConversationRecord, EngineError>;
    /// Project-qualified rows for the chat browser across every registered project.
    async fn conversations_index(&self) -> Result<ConversationsIndexResponse, EngineError>;
    /// Create a conversation and durably queue its exact first user turn without opening a
    /// provider. Pair with [`Engine::activate_conversations`] once a live listener is installed.
    async fn create_conversation(
        &self,
        scope: &Scope,
        input: CreateConversationInput,
    ) -> Result<CreateConversationResponse, EngineError>;
    /// Start whichever queued turns this project's capacity currently allows.
    async fn activate_conversations(&self, scope: &Scope) -> Result<(), EngineError>;
    /// Queue exactly one ordinary follow-up turn. Refused while a turn is already active.
    async fn submit_conversation_message(
        &self,
        scope: &Scope,
        conversation_id: &str,
        input: SubmitConversationMessageInput,
    ) -> Result<SubmitConversationMessageResponse, EngineError>;
    /// Answer one native structured question inside the turn that asked it.
    async fn answer_conversation_question(
        &self,
        scope: &Scope,
        conversation_id: &str,
        input: AnswerConversationQuestionInput,
    ) -> Result<AnswerConversationQuestionResponse, EngineError>;
    /// Cancel the active turn, leaving the conversation follow-up capable.
    async fn cancel_conversation_turn(
        &self,
        scope: &Scope,
        conversation_id: &str,
    ) -> Result<CancelConversationTurnResponse, EngineError>;
    /// Abandon a provider session the harness would not resume and prepare a new one. Sends
    /// nothing: the user's next message carries the bounded handoff. Confirm with the user
    /// before calling — nothing in the runtime may reach this on its own.
    async fn restart_conversation_session(
        &self,
        scope: &Scope,
        conversation_id: &str,
    ) -> Result<RestartConversationSessionResponse, EngineError>;
    async fn archive_conversation(
        &self,
        scope: &Scope,
        conversation_id: &str,
    ) -> Result<ArchiveConversationResponse, EngineError>;
    async fn unarchive_conversation(
        &self,
        scope: &Scope,
        conversation_id: &str,
    ) -> Result<UnarchiveConversationResponse, EngineError>;
    /// Delete a conversation, its transcript, and any managed worktree it owned.
    async fn delete_conversation(
        &self,
        scope: &Scope,
        conversation_id: &str,
    ) -> Result<DeleteConversationResponse, EngineError>;
    /// Mark a conversation read or unread.
    async fn read_conversation(
        &self,
        scope: &Scope,
        conversation_id: &str,
        seen: bool,
    ) -> Result<ConversationRecord, EngineError>;
    /// One page of a conversation's durable timeline.
    async fn conversation_history(
        &self,
        scope: &Scope,
        conversation_id: &str,
        cursor: Option<&str>,
    ) -> Result<RunHistoryPage, EngineError>;
    /// Change the idle Git policy. Automatic mode commits and pushes the conversation's
    /// current branch — in its managed worktree, or in the checkout itself when none exists.
    async fn update_conversation_git_mode(
        &self,
        scope: &Scope,
        conversation_id: &str,
        input: UpdateConversationGitModeInput,
    ) -> Result<UpdateConversationGitModeResponse, EngineError>;

    // ---- IDE: project file browser + editor ------------------------------------------------
    /// Resolve a scope's repository root on disk — a registered project's root or the
    /// engine's workspace root — for the `$EDITOR` handoff.
    fn project_root(&self, scope: &Scope) -> Result<String, EngineError>;
    /// Return one directory listing at the given project-relative path (`None` = root).
    async fn ide_tree(
        &self,
        scope: &Scope,
        path: Option<&str>,
    ) -> Result<IdeDirectoryResponse, EngineError>;
    /// Return one file's content, capped at 1 MB.
    async fn ide_file(&self, scope: &Scope, path: &str) -> Result<IdeFileResponse, EngineError>;
    /// Save `content` to `path`, returning the stored file's metadata.
    async fn ide_save(
        &self,
        scope: &Scope,
        path: &str,
        content: &str,
    ) -> Result<IdeFileResponse, EngineError>;

    // ---- Settings --------------------------------------------------------------------------
    /// Update the global settings slice (account defaults, resources, and project checkout root).
    async fn put_workspace_config(
        &self,
        input: &SetWorkspaceConfigInput,
    ) -> Result<WorkspaceConfigResponse, EngineError>;
    /// Return cross-project UI state (notifications and appearance).
    async fn workspace_ui_state(&self) -> Result<WorkspaceUiState, EngineError>;
    /// Shallow-merge cross-project UI state.
    async fn put_workspace_ui_state(
        &self,
        input: &SetWorkspaceUiStateInput,
    ) -> Result<WorkspaceUiState, EngineError>;
    /// Return the selected project's agent-owned config catalog.
    async fn agent_config(&self, scope: &Scope) -> Result<AgentConfigListing, EngineError>;
    /// Return one agent config file's raw contents.
    async fn agent_config_file(
        &self,
        scope: &Scope,
        id: &str,
    ) -> Result<AgentConfigFileContent, EngineError>;
    /// Save one agent config file.
    async fn put_agent_config_file(
        &self,
        scope: &Scope,
        id: &str,
        input: &SetAgentConfigInput,
    ) -> Result<AgentConfigFileContent, EngineError>;
    /// Register an extra config directory as an account.
    async fn create_agent_profile(
        &self,
        input: &CreateAgentProfileInput,
    ) -> Result<AgentProfileResponse, EngineError>;
    /// Rename an account or repoint its folder.
    async fn update_agent_profile(
        &self,
        id: &str,
        input: &UpdateAgentProfileInput,
    ) -> Result<AgentProfileResponse, EngineError>;
    /// Deregister an account.
    async fn remove_agent_profile(
        &self,
        id: &str,
    ) -> Result<RemoveAgentProfileResponse, EngineError>;
    /// Return one account's auth state, probed for real.
    async fn agent_account_status(
        &self,
        id: &str,
        refresh: bool,
    ) -> Result<AgentAccountStatusResponse, EngineError>;
    /// Return who an account is signed in as.
    async fn agent_account_details(
        &self,
        id: &str,
    ) -> Result<AgentAccountDetailsResponse, EngineError>;
    /// Open one of an account's config files.
    async fn open_agent_account_file(
        &self,
        id: &str,
        input: &OpenAgentAccountFileInput,
    ) -> Result<OpenAgentAccountFileResponse, EngineError>;
    /// Point one project's provider at an account.
    async fn select_agent_profile(
        &self,
        input: &SelectAgentProfileInput,
    ) -> Result<AgentProfileSelectionsResponse, EngineError>;
    /// Deregister a project from the workspace registry.
    async fn remove_project(&self, project_id: &str) -> Result<RemoveProjectResponse, EngineError>;
    /// Update a project's concurrency ceiling and tags.
    async fn update_project(
        &self,
        project_id: &str,
        input: &UpdateProjectInput,
    ) -> Result<UpdateProjectResponse, EngineError>;
    /// Return every materialized task worktree, disk usage, and retention state.
    async fn worktrees(&self, scope: &Scope) -> Result<WorktreesResponse, EngineError>;
    /// Force the retention enforcer to reclaim over-limit worktrees.
    async fn reclaim_worktrees(
        &self,
        scope: &Scope,
    ) -> Result<ReclaimWorktreesResponse, EngineError>;
    /// Reclaim one run's worktree and its branch.
    async fn remove_run_worktree(
        &self,
        scope: &Scope,
        run_id: &str,
    ) -> Result<RemoveWorktreeResponse, EngineError>;
    /// Return the local editors, file managers, and terminals this machine can open.
    async fn open_targets(&self, scope: &Scope) -> Result<OpenTargetsResponse, EngineError>;
    /// Open the active project's folder in the chosen local app.
    async fn open_project_in(
        &self,
        scope: &Scope,
        target: &str,
    ) -> Result<OpenProjectInResponse, EngineError>;

    fn subscribe(&self, topic: Topic) -> BoxStream<'static, EngineEvent>;
}

fn decode_in_process_ui_state(value: Value) -> Result<UiState, EngineError> {
    serde_json::from_value(value)
        .map_err(|error| EngineError::Transport(format!("invalid in-process ui state: {error}")))
}

#[async_trait]
impl Engine for InProcessEngine {
    async fn health(&self) -> Result<HealthResponse, EngineError> {
        InProcessEngine::health(self).await
    }

    async fn list_runs(&self, scope: &Scope) -> Result<Vec<ApiRun>, EngineError> {
        self.scoped(scope)?.list_runs().await
    }

    // ---- conversations ----------------------------------------------------------------------

    async fn list_conversations(
        &self,
        scope: &Scope,
    ) -> Result<Vec<ConversationRecord>, EngineError> {
        InProcessEngine::list_conversations(self, scope).await
    }

    async fn get_conversation(
        &self,
        scope: &Scope,
        conversation_id: &str,
    ) -> Result<ConversationRecord, EngineError> {
        InProcessEngine::get_conversation(self, scope, conversation_id).await
    }

    async fn conversations_index(&self) -> Result<ConversationsIndexResponse, EngineError> {
        InProcessEngine::conversations_index(self).await
    }

    async fn create_conversation(
        &self,
        scope: &Scope,
        input: CreateConversationInput,
    ) -> Result<CreateConversationResponse, EngineError> {
        InProcessEngine::create_conversation(self, scope, input).await
    }

    async fn activate_conversations(&self, scope: &Scope) -> Result<(), EngineError> {
        InProcessEngine::activate_conversations(self, scope)
    }

    async fn submit_conversation_message(
        &self,
        scope: &Scope,
        conversation_id: &str,
        input: SubmitConversationMessageInput,
    ) -> Result<SubmitConversationMessageResponse, EngineError> {
        InProcessEngine::submit_conversation_message(self, scope, conversation_id, input).await
    }

    async fn answer_conversation_question(
        &self,
        scope: &Scope,
        conversation_id: &str,
        input: AnswerConversationQuestionInput,
    ) -> Result<AnswerConversationQuestionResponse, EngineError> {
        InProcessEngine::answer_conversation_question(self, scope, conversation_id, input).await
    }

    async fn cancel_conversation_turn(
        &self,
        scope: &Scope,
        conversation_id: &str,
    ) -> Result<CancelConversationTurnResponse, EngineError> {
        InProcessEngine::cancel_conversation_turn(self, scope, conversation_id).await
    }

    async fn restart_conversation_session(
        &self,
        scope: &Scope,
        conversation_id: &str,
    ) -> Result<RestartConversationSessionResponse, EngineError> {
        InProcessEngine::restart_conversation_session(self, scope, conversation_id).await
    }

    async fn archive_conversation(
        &self,
        scope: &Scope,
        conversation_id: &str,
    ) -> Result<ArchiveConversationResponse, EngineError> {
        InProcessEngine::archive_conversation(self, scope, conversation_id, true)
            .await
            .map(|record| ArchiveConversationResponse {
                archived: record.archived,
            })
    }

    async fn unarchive_conversation(
        &self,
        scope: &Scope,
        conversation_id: &str,
    ) -> Result<UnarchiveConversationResponse, EngineError> {
        InProcessEngine::archive_conversation(self, scope, conversation_id, false)
            .await
            .map(|record| UnarchiveConversationResponse {
                unarchived: !record.archived,
            })
    }

    async fn delete_conversation(
        &self,
        scope: &Scope,
        conversation_id: &str,
    ) -> Result<DeleteConversationResponse, EngineError> {
        InProcessEngine::delete_conversation(self, scope, conversation_id).await
    }

    async fn read_conversation(
        &self,
        scope: &Scope,
        conversation_id: &str,
        seen: bool,
    ) -> Result<ConversationRecord, EngineError> {
        InProcessEngine::read_conversation(self, scope, conversation_id, seen).await
    }

    async fn conversation_history(
        &self,
        scope: &Scope,
        conversation_id: &str,
        cursor: Option<&str>,
    ) -> Result<RunHistoryPage, EngineError> {
        InProcessEngine::conversation_history(self, scope, conversation_id, cursor).await
    }

    async fn update_conversation_git_mode(
        &self,
        scope: &Scope,
        conversation_id: &str,
        input: UpdateConversationGitModeInput,
    ) -> Result<UpdateConversationGitModeResponse, EngineError> {
        InProcessEngine::update_conversation_git_mode(self, scope, conversation_id, input).await
    }

    async fn get_run(&self, scope: &Scope, run_id: &str) -> Result<ApiRun, EngineError> {
        self.scoped(scope)?.get_run(run_id).await
    }

    async fn archive_run(
        &self,
        scope: &Scope,
        run_id: &str,
        archived: bool,
    ) -> Result<ApiRun, EngineError> {
        self.scoped(scope)?.archive_run(run_id, archived).await
    }

    async fn delete_run(
        &self,
        scope: &Scope,
        run_id: &str,
    ) -> Result<DeleteRunResponse, EngineError> {
        self.scoped(scope)?.delete_run(run_id).await
    }

    async fn read_run(&self, scope: &Scope, run_id: &str) -> Result<ApiRun, EngineError> {
        self.scoped(scope)?.read_run(run_id).await
    }

    async fn unread_run(&self, scope: &Scope, run_id: &str) -> Result<ApiRun, EngineError> {
        self.scoped(scope)?.unread_run(run_id).await
    }

    async fn archive_finished(
        &self,
        scope: &Scope,
    ) -> Result<ArchiveFinishedResponse, EngineError> {
        self.scoped(scope)?.archive_finished().await
    }

    async fn mark_all_read(&self, scope: &Scope) -> Result<MarkAllReadResponse, EngineError> {
        self.scoped(scope)?.mark_all_read().await
    }

    async fn runs_index(&self) -> Result<RunsIndexResponse, EngineError> {
        InProcessEngine::runs_index(self).await
    }

    async fn skills(&self, scope: &Scope) -> Result<Vec<Skill>, EngineError> {
        self.scoped(scope)?.skills().await
    }

    async fn projects(&self) -> Result<ProjectsResponse, EngineError> {
        InProcessEngine::projects(self).await
    }

    async fn register_project(
        &self,
        input: &RegisterProjectInput,
    ) -> Result<RegisterProjectResponse, EngineError> {
        InProcessEngine::register_project(self, input).await
    }

    async fn workspace_config(&self) -> Result<WorkspaceConfigResponse, EngineError> {
        InProcessEngine::workspace_config(self).await
    }

    async fn workspace_usage(&self) -> Result<WorkspaceUsageResponse, EngineError> {
        InProcessEngine::workspace_usage(self).await
    }

    async fn config(&self, scope: &Scope) -> Result<ConfigResponse, EngineError> {
        self.scoped(scope)?.config().await
    }

    async fn put_config(
        &self,
        scope: &Scope,
        input: &SetConfigInput,
    ) -> Result<ConfigResponse, EngineError> {
        self.scoped(scope)?.put_config(input).await
    }

    async fn provider_status(&self) -> Result<ProviderStatusResponse, EngineError> {
        InProcessEngine::provider_status(self).await
    }

    async fn connect_provider(
        &self,
        input: &ProviderConnectInput,
    ) -> Result<ProviderConnectResponse, EngineError> {
        InProcessEngine::connect_provider(self, input).await
    }

    async fn models(&self, runner: Runner) -> Result<RunnerModelCatalogResponse, EngineError> {
        InProcessEngine::models(self, runner).await
    }

    async fn github(&self, scope: &Scope) -> Result<GithubData, EngineError> {
        self.scoped(scope)?.github().await
    }

    async fn github_checks(
        &self,
        scope: &Scope,
        prs: &[String],
    ) -> Result<GithubChecksData, EngineError> {
        self.scoped(scope)?.github_checks(prs).await
    }

    async fn github_ref_status(
        &self,
        scope: &Scope,
        prs: &[String],
        issues: &[String],
    ) -> Result<GithubRefStatusData, EngineError> {
        self.scoped(scope)?.github_ref_status(prs, issues).await
    }

    async fn github_comments(
        &self,
        scope: &Scope,
        kind: &str,
        number: u64,
    ) -> Result<GithubCommentsData, EngineError> {
        self.scoped(scope)?.github_comments(kind, number).await
    }

    async fn github_pr_merge_state(
        &self,
        scope: &Scope,
        number: u64,
    ) -> Result<GithubPrMergeStateResponse, EngineError> {
        self.scoped(scope)?.github_pr_merge_state(number).await
    }

    async fn github_merge_pr(
        &self,
        scope: &Scope,
        number: u64,
        input: &GithubMergeInput,
    ) -> Result<GithubMergeResponse, EngineError> {
        self.scoped(scope)?.github_merge_pr(number, input).await
    }

    async fn github_pr_changes(
        &self,
        scope: &Scope,
        number: u64,
    ) -> Result<GithubPrChangesData, EngineError> {
        self.scoped(scope)?.github_pr_changes(number).await
    }

    async fn agent_profiles(&self) -> Result<AgentProfilesResponse, EngineError> {
        InProcessEngine::agent_profiles(self).await
    }

    async fn ui_state(&self, scope: &Scope) -> Result<UiState, EngineError> {
        decode_in_process_ui_state(self.scoped(scope)?.ui_state().await?)
    }

    async fn put_ui_state(&self, scope: &Scope, state: &UiState) -> Result<UiState, EngineError> {
        let value = serde_json::to_value(state).map_err(|error| {
            EngineError::Transport(format!("could not encode ui state: {error}"))
        })?;
        decode_in_process_ui_state(self.scoped(scope)?.put_ui_state(value).await?)
    }

    async fn scratchpad(&self, scope: &Scope) -> Result<Scratchpad, EngineError> {
        InProcessEngine::scratchpad(self, scope).await
    }

    async fn put_scratchpad(
        &self,
        scope: &Scope,
        input: &SetScratchpadInput,
    ) -> Result<Scratchpad, EngineError> {
        InProcessEngine::put_scratchpad(self, scope, input).await
    }

    async fn run_history(
        &self,
        scope: &Scope,
        run_id: &str,
        cursor: Option<&str>,
    ) -> Result<RunHistoryPage, EngineError> {
        self.scoped(scope)?.run_history(run_id, cursor).await
    }

    async fn run_history_context(
        &self,
        scope: &Scope,
        run_id: &str,
    ) -> Result<RunHistoryContext, EngineError> {
        self.scoped(scope)?.run_history_context(run_id).await
    }

    async fn open_in(
        &self,
        scope: &Scope,
        run_id: &str,
        input: OpenInInput,
    ) -> Result<Value, EngineError> {
        self.scoped(scope)?.open_in(run_id, input).await
    }

    async fn git_commit(
        &self,
        scope: &Scope,
        run_id: &str,
        input: GitCommitInput,
    ) -> Result<GitCommitResponse, EngineError> {
        self.scoped(scope)?.git_commit(run_id, input).await
    }

    async fn git_push(&self, scope: &Scope, run_id: &str) -> Result<GitPushResponse, EngineError> {
        self.scoped(scope)?.git_push(run_id).await
    }

    async fn run_commits(
        &self,
        scope: &Scope,
        run_id: &str,
    ) -> Result<RunCommitsResponse, EngineError> {
        self.scoped(scope)?.run_commits(run_id).await
    }

    async fn create_pr(
        &self,
        scope: &Scope,
        run_id: &str,
    ) -> Result<CreatePrResponse, EngineError> {
        self.scoped(scope)?.create_pr(run_id).await
    }

    async fn run_diff_text(&self, scope: &Scope, run_id: &str) -> Result<String, EngineError> {
        self.scoped(scope)?.run_diff_text(run_id).await
    }

    async fn run_changes(
        &self,
        scope: &Scope,
        run_id: &str,
    ) -> Result<ChangesPayload, EngineError> {
        self.scoped(scope)?.run_changes(run_id).await
    }

    async fn run_commit(
        &self,
        scope: &Scope,
        run_id: &str,
        sha: &str,
    ) -> Result<RepoCommitPayload, EngineError> {
        self.scoped(scope)?.run_commit(run_id, sha).await
    }

    async fn run_files(
        &self,
        scope: &Scope,
        run_id: &str,
        path: Option<&str>,
    ) -> Result<WorktreeEntry, EngineError> {
        self.scoped(scope)?.run_files(run_id, path).await
    }

    async fn run_file_raw(
        &self,
        scope: &Scope,
        run_id: &str,
        path: &str,
    ) -> Result<Vec<u8>, EngineError> {
        self.scoped(scope)?.run_file_raw(run_id, path).await
    }

    async fn repo(&self, scope: &Scope) -> Result<RepoResponse, EngineError> {
        self.scoped(scope)?.repo().await
    }

    async fn repo_changes(&self, scope: &Scope) -> Result<ChangesPayload, EngineError> {
        self.scoped(scope)?.repo_changes().await
    }

    async fn repo_commit(
        &self,
        scope: &Scope,
        sha: &str,
    ) -> Result<RepoCommitPayload, EngineError> {
        self.scoped(scope)?.repo_commit(sha).await
    }

    async fn repo_branch(
        &self,
        scope: &Scope,
        input: &RepoBranchRequest,
    ) -> Result<RepoBranchResponse, EngineError> {
        self.scoped(scope)?.repo_branch(input).await
    }

    async fn ide_tree(
        &self,
        scope: &Scope,
        path: Option<&str>,
    ) -> Result<IdeDirectoryResponse, EngineError> {
        self.scoped(scope)?.ide_tree(path).await
    }

    fn project_root(&self, scope: &Scope) -> Result<String, EngineError> {
        self.root_for_scope(scope)
            .map(|root| root.display().to_string())
    }

    async fn ide_file(&self, scope: &Scope, path: &str) -> Result<IdeFileResponse, EngineError> {
        self.scoped(scope)?.ide_file(path).await
    }

    async fn ide_save(
        &self,
        scope: &Scope,
        path: &str,
        content: &str,
    ) -> Result<IdeFileResponse, EngineError> {
        self.scoped(scope)?.ide_save(path, content).await
    }

    async fn put_workspace_config(
        &self,
        input: &SetWorkspaceConfigInput,
    ) -> Result<WorkspaceConfigResponse, EngineError> {
        InProcessEngine::put_workspace_config(self, input).await
    }

    async fn workspace_ui_state(&self) -> Result<WorkspaceUiState, EngineError> {
        InProcessEngine::workspace_ui_state(self).await
    }

    async fn put_workspace_ui_state(
        &self,
        input: &SetWorkspaceUiStateInput,
    ) -> Result<WorkspaceUiState, EngineError> {
        InProcessEngine::put_workspace_ui_state(self, input).await
    }

    async fn agent_config(&self, scope: &Scope) -> Result<AgentConfigListing, EngineError> {
        self.scoped(scope)?.agent_config().await
    }

    async fn agent_config_file(
        &self,
        scope: &Scope,
        id: &str,
    ) -> Result<AgentConfigFileContent, EngineError> {
        self.scoped(scope)?.agent_config_file(id).await
    }

    async fn put_agent_config_file(
        &self,
        scope: &Scope,
        id: &str,
        input: &SetAgentConfigInput,
    ) -> Result<AgentConfigFileContent, EngineError> {
        self.scoped(scope)?.put_agent_config_file(id, input).await
    }

    async fn create_agent_profile(
        &self,
        input: &CreateAgentProfileInput,
    ) -> Result<AgentProfileResponse, EngineError> {
        InProcessEngine::create_agent_profile(self, input).await
    }

    async fn update_agent_profile(
        &self,
        id: &str,
        input: &UpdateAgentProfileInput,
    ) -> Result<AgentProfileResponse, EngineError> {
        InProcessEngine::update_agent_profile(self, id, input).await
    }

    async fn remove_agent_profile(
        &self,
        id: &str,
    ) -> Result<RemoveAgentProfileResponse, EngineError> {
        InProcessEngine::remove_agent_profile(self, id).await
    }

    async fn agent_account_status(
        &self,
        id: &str,
        refresh: bool,
    ) -> Result<AgentAccountStatusResponse, EngineError> {
        InProcessEngine::agent_account_status(self, id, refresh).await
    }

    async fn agent_account_details(
        &self,
        id: &str,
    ) -> Result<AgentAccountDetailsResponse, EngineError> {
        InProcessEngine::agent_account_details(self, id).await
    }

    async fn open_agent_account_file(
        &self,
        id: &str,
        input: &OpenAgentAccountFileInput,
    ) -> Result<OpenAgentAccountFileResponse, EngineError> {
        InProcessEngine::open_agent_account_file(self, id, input).await
    }

    async fn select_agent_profile(
        &self,
        input: &SelectAgentProfileInput,
    ) -> Result<AgentProfileSelectionsResponse, EngineError> {
        InProcessEngine::select_agent_profile(self, input).await
    }

    async fn remove_project(&self, project_id: &str) -> Result<RemoveProjectResponse, EngineError> {
        InProcessEngine::remove_project(self, project_id).await
    }

    async fn update_project(
        &self,
        project_id: &str,
        input: &UpdateProjectInput,
    ) -> Result<UpdateProjectResponse, EngineError> {
        InProcessEngine::update_project(self, project_id, input).await
    }

    async fn worktrees(&self, scope: &Scope) -> Result<WorktreesResponse, EngineError> {
        self.scoped(scope)?.worktrees().await
    }

    async fn reclaim_worktrees(
        &self,
        scope: &Scope,
    ) -> Result<ReclaimWorktreesResponse, EngineError> {
        self.scoped(scope)?.reclaim_worktrees().await
    }

    async fn remove_run_worktree(
        &self,
        scope: &Scope,
        run_id: &str,
    ) -> Result<RemoveWorktreeResponse, EngineError> {
        self.scoped(scope)?.remove_run_worktree(run_id).await
    }

    async fn open_targets(&self, scope: &Scope) -> Result<OpenTargetsResponse, EngineError> {
        self.scoped(scope)?.open_targets().await
    }

    async fn open_project_in(
        &self,
        scope: &Scope,
        target: &str,
    ) -> Result<OpenProjectInResponse, EngineError> {
        InProcessEngine::open_project_in(self, scope, target).await
    }

    fn subscribe(&self, topic: Topic) -> BoxStream<'static, EngineEvent> {
        InProcessEngine::subscribe(self, topic)
    }
}
