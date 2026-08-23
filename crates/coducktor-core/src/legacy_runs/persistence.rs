use super::*;

impl RunManager {
    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    pub fn set_project_id(&mut self, project_id: impl Into<String>) {
        self.project_id = project_id.into();
    }

    pub fn get_run(&self, run_id: &str) -> Option<&RunRecord> {
        self.runs.get(run_id)
    }

    pub fn list_runs(&self) -> Vec<RunRecord> {
        let records: Vec<RunRecord> = self.runs.values().cloned().collect();
        store::list_runs_by_recency(&records)
            .into_iter()
            .cloned()
            .collect()
    }

    /// Remove a run and its append-only event log. Callers must check that the run is not active.
    pub fn remove_run(&mut self, run_id: &str) -> io::Result<bool> {
        let Some(run) = self.runs.remove(run_id) else {
            return Ok(false);
        };
        if let Err(error) = self.persist() {
            self.runs.insert(run_id.to_owned(), run);
            return Err(error);
        }
        let event_path = events::events_path(&self.data_dir, run_id);
        let _ = fs::remove_file(event_path);
        crate::handoff::delete_handoff(&self.data_dir, run_id);
        Ok(true)
    }

    /// Remove terminal records beyond the durable index retention budget. The replacement index
    /// is committed before best-effort sidecar cleanup, so a crash cannot leave an index entry
    /// that points at already-deleted history. Queued, running, and waiting work is never a
    /// retention candidate, even if an old clock or imported state makes it look stale.
    ///
    /// Worktrees have their own explicit retention policy: removing an index record must not
    /// remove a checkout that may contain recoverable agent edits.
    pub fn prune_stale_runs(&mut self) -> io::Result<Vec<String>> {
        let candidates = store::select_stale_run_ids(&self.list_runs());
        let stale: Vec<String> = candidates
            .into_iter()
            .filter(|run_id| {
                self.runs.get(run_id).is_some_and(|run| {
                    matches!(
                        run.status,
                        RunStatus::Done
                            | RunStatus::Failed
                            | RunStatus::Cancelled
                            | RunStatus::Review
                    )
                })
            })
            .collect();
        if stale.is_empty() {
            return Ok(stale);
        }

        let removed: Vec<(String, RunRecord)> = stale
            .iter()
            .filter_map(|run_id| self.runs.remove(run_id).map(|run| (run_id.clone(), run)))
            .collect();
        if let Err(error) = self.persist() {
            self.runs.extend(removed);
            return Err(error);
        }
        for run_id in &stale {
            let _ = fs::remove_file(events::events_path(&self.data_dir, run_id));
            crate::handoff::delete_handoff(&self.data_dir, run_id);
        }
        Ok(stale)
    }

    /// Register an observer for appended events. The callback is invoked after the NDJSON append
    /// succeeds and receives an owned notification view, so it cannot mutate manager state by
    /// aliasing a record reference.
    pub fn subscribe_events<F>(&mut self, observer: F) -> EventObserverId
    where
        F: Fn(&RunEventNotification) + Send + Sync + 'static,
    {
        let id = self.next_observer_id();
        self.event_observers.insert(id, Box::new(observer));
        id
    }

    pub fn unsubscribe_events(&mut self, observer_id: EventObserverId) -> bool {
        self.event_observers.remove(&observer_id).is_some()
    }

    /// Register an observer for durable record updates.
    pub fn subscribe_runs<F>(&mut self, observer: F) -> RunObserverId
    where
        F: Fn(&RunRecord) + Send + Sync + 'static,
    {
        let id = self.next_observer_id();
        self.run_observers.insert(id, Box::new(observer));
        id
    }

    pub fn unsubscribe_runs(&mut self, observer_id: RunObserverId) -> bool {
        self.run_observers.remove(&observer_id).is_some()
    }

    pub(super) fn next_observer_id(&mut self) -> u64 {
        self.next_observer_id = self.next_observer_id.wrapping_add(1);
        self.next_observer_id
    }

    pub(super) fn persist(&mut self) -> io::Result<()> {
        if self.write_quarantined {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "runs.json is quarantined because existing state could not be fully loaded",
            ));
        }
        fs::create_dir_all(self.data_dir.join("runs"))?;
        let records: Vec<RunRecord> = self.runs.values().cloned().collect();
        let index_path = store::index_path(&self.data_dir);
        store::write_run_index(&index_path, &records)?;
        self.index_write_count += 1;
        if let Ok(metadata) = fs::metadata(index_path) {
            self.index_write_bytes = self.index_write_bytes.saturating_add(metadata.len());
        }
        self.last_index_flush = Instant::now();
        Ok(())
    }

    /// Flush is kept explicit for callers that want a named shutdown boundary. Mutations are
    /// already written synchronously before they return.
    pub fn flush(&mut self) -> io::Result<()> {
        self.persist()
    }

    /// Repair state that was quarantined during load. This is deliberately explicit: the
    /// original index is backed up before the currently salvaged records replace it.
    pub fn repair_quarantined_index(&mut self) -> io::Result<Option<PathBuf>> {
        if !self.write_quarantined {
            return Ok(None);
        }
        let records: Vec<RunRecord> = self.runs.values().cloned().collect();
        let backup =
            store::backup_then_repair_run_index(&store::index_path(&self.data_dir), &records)?;
        self.write_quarantined = false;
        self.last_index_flush = Instant::now();
        Ok(Some(backup))
    }

    pub(super) fn notify_run(&self, run: &RunRecord) {
        for observer in self.run_observers.values() {
            observer(run);
        }
    }

    pub(super) fn notify_event(&self, notification: &RunEventNotification) {
        for observer in self.event_observers.values() {
            observer(notification);
        }
    }

    pub(super) fn replace_record(
        &mut self,
        run_id: &str,
        previous: RunRecord,
        next: RunRecord,
    ) -> io::Result<RunRecord> {
        self.runs.insert(run_id.to_owned(), next.clone());
        if let Err(error) = self.persist() {
            self.runs.insert(run_id.to_owned(), previous);
            return Err(error);
        }
        self.notify_run(&next);
        Ok(next)
    }

    /// Create and durably persist a queued record.
    pub fn create_run(&mut self, input: CreateRunInput) -> io::Result<RunRecord> {
        let id = new_run_id();
        let created_at = now_iso8601();
        let mut steps: Vec<StepState> = input.steps.into_iter().map(step_from_seed).collect();
        if let (Some(decision), Some(first)) = (input.routing_decision, steps.first_mut()) {
            first.routing_decision = Some(decision);
        }
        let run = RunRecord {
            id: id.clone(),
            title: input.title,
            workflow: input.workflow,
            task: input.task,
            task_images: input.task_images,
            model: input.model,
            reasoning_effort: input.reasoning_effort,
            model_identity: input.model_identity,
            runner: input.runner,
            requested_runner: input.requested_runner,
            agent_profile: input.agent_profile,
            system_prompt: input.system_prompt,
            autonomous: input.autonomous,
            git_auto: input.git_auto,
            worktree: input.worktree,
            group_id: input.group_id,
            variant: input.variant,
            status: RunStatus::Queued,
            created_at: created_at.clone(),
            updated_at: Some(created_at),
            tokens_used: 0.0,
            archived: false,
            steps,
            workflow_def: input.workflow_def,
            ..RunRecord::default()
        };
        self.runs.insert(id.clone(), run.clone());
        if let Err(error) = self.persist() {
            self.runs.remove(&id);
            return Err(error);
        }
        self.notify_run(&run);
        Ok(run)
    }

    /// Apply a durable contract-shaped patch. Unknown keys are ignored by the shared serde
    /// contract, while wrong values fail before the old record is replaced.
    pub fn update_run(&mut self, run_id: &str, patch: RunPatch) -> io::Result<Option<RunRecord>> {
        let Some(previous) = self.runs.get(run_id).cloned() else {
            return Ok(None);
        };
        let mut next = apply_run_patch(&previous, patch.fields())?;
        next.updated_at = Some(now_iso8601());
        self.replace_record(run_id, previous, next).map(Some)
    }

    pub fn update_run_value(
        &mut self,
        run_id: &str,
        patch: Value,
    ) -> io::Result<Option<RunRecord>> {
        let patch = RunPatch::from_value(patch)
            .map_err(|message| io::Error::new(io::ErrorKind::InvalidInput, message))?;
        self.update_run(run_id, patch)
    }

    /// Escape hatch for lifecycle code that already has a typed `RunRecord` mutation. The
    /// resulting value still goes through the same durable replace/rollback path.
    pub fn edit_run<F>(&mut self, run_id: &str, edit: F) -> io::Result<Option<RunRecord>>
    where
        F: FnOnce(&mut RunRecord),
    {
        let Some(previous) = self.runs.get(run_id).cloned() else {
            return Ok(None);
        };
        let mut next = previous.clone();
        edit(&mut next);
        next.updated_at = Some(now_iso8601());
        self.replace_record(run_id, previous, next).map(Some)
    }

    /// Append one event with a manager-owned sequence and timestamp.
    pub fn append_event(&mut self, run_id: &str, input: EventInput) -> io::Result<RunEvent> {
        if !self.runs.contains_key(run_id) {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                format!("unknown run: {run_id}"),
            ));
        }
        let path = events::events_path(&self.data_dir, run_id);
        let seq = self
            .seqs
            .get(run_id)
            .copied()
            .unwrap_or_else(|| events::rehydrate_seq(&path))
            + 1.0;
        let event = RunEvent {
            seq,
            ts: now_iso8601(),
            step_id: input.step_id,
            event_type: input.event_type,
            extra: input.extra,
        };
        if !self.event_appenders.contains_key(run_id) {
            self.event_appenders.insert(
                run_id.to_owned(),
                events::BufferedEventAppender::open(&path)?,
            );
        }
        self.event_appenders
            .get_mut(run_id)
            .ok_or_else(|| io::Error::other("event appender unavailable"))?
            .append(&event)?;
        self.event_append_count += 1;
        // Event append is meaningful activity. Keep read/unread and archive mutations on their
        // separate timestamps by stamping here instead of in the generic record replacement.
        let updated_run = if let Some(run) = self.runs.get_mut(run_id) {
            run.updated_at = Some(event.ts.clone());
            Some(run.clone())
        } else {
            None
        };
        let flush_index = self.last_index_flush.elapsed() >= Duration::from_millis(250);
        if updated_run.is_some() && flush_index {
            self.persist()?;
        }
        self.seqs.insert(run_id.to_owned(), seq);
        if flush_index && let Some(run) = &updated_run {
            self.notify_run(run);
        }
        let notification = RunEventNotification {
            run_id: run_id.to_owned(),
            event: event.clone(),
        };
        self.notify_event(&notification);
        Ok(event)
    }

    /// Read the raw event history through the shared event reader.
    pub fn read_events(&self, run_id: &str) -> Vec<RunEvent> {
        events::read_events(&events::events_path(&self.data_dir, run_id))
    }

    pub fn set_archived(&mut self, run_id: &str, archived: bool) -> io::Result<Option<RunRecord>> {
        let now = now_iso8601();
        let Some(previous) = self.runs.get(run_id).cloned() else {
            return Ok(None);
        };
        let mut next = previous.clone();
        next.archived = archived;
        next.archived_at = archived.then_some(now);
        if archived {
            next.auto_resume_at = None;
            next.auto_resume_attempts = None;
        }
        self.replace_record(run_id, previous, next).map(Some)
    }

    pub fn archive(&mut self, run_id: &str, archived: bool) -> io::Result<Option<RunRecord>> {
        self.set_archived(run_id, archived)
    }

    /// Archive every terminal run in one durable write and return the number changed.
    pub fn archive_finished(&mut self) -> io::Result<usize> {
        let now = now_iso8601();
        let previous = self.runs.clone();
        let mut changed = Vec::new();
        for run in self.runs.values_mut() {
            if !run.archived
                && matches!(
                    run.status,
                    RunStatus::Done | RunStatus::Failed | RunStatus::Cancelled
                )
            {
                run.archived = true;
                run.archived_at = Some(now.clone());
                run.auto_resume_at = None;
                run.auto_resume_attempts = None;
                changed.push(run.clone());
            }
        }
        if changed.is_empty() {
            return Ok(0);
        }
        if let Err(error) = self.persist() {
            self.runs = previous;
            return Err(error);
        }
        for run in &changed {
            self.notify_run(run);
        }
        Ok(changed.len())
    }

    pub fn set_read(&mut self, run_id: &str) -> io::Result<Option<RunRecord>> {
        let Some(previous) = self.runs.get(run_id).cloned() else {
            return Ok(None);
        };
        let mut next = previous.clone();
        next.seen_at = Some(now_iso8601());
        self.replace_record(run_id, previous, next).map(Some)
    }

    pub fn mark_read(&mut self, run_id: &str) -> io::Result<Option<RunRecord>> {
        self.set_read(run_id)
    }

    pub fn set_unread(&mut self, run_id: &str) -> io::Result<Option<RunRecord>> {
        let Some(previous) = self.runs.get(run_id).cloned() else {
            return Ok(None);
        };
        let mut next = previous.clone();
        next.seen_at = None;
        self.replace_record(run_id, previous, next).map(Some)
    }

    pub fn mark_unread(&mut self, run_id: &str) -> io::Result<Option<RunRecord>> {
        self.set_unread(run_id)
    }

    /// Stamp currently unread finished runs and return the number stamped.
    pub fn mark_all_read(&mut self) -> io::Result<usize> {
        let now = now_iso8601();
        let previous = self.runs.clone();
        let mut changed = Vec::new();
        for run in self.runs.values_mut() {
            if is_unread(run) {
                run.seen_at = Some(now.clone());
                changed.push(run.clone());
            }
        }
        if changed.is_empty() {
            return Ok(0);
        }
        if let Err(error) = self.persist() {
            self.runs = previous;
            return Err(error);
        }
        for run in &changed {
            self.notify_run(run);
        }
        Ok(changed.len())
    }
}
