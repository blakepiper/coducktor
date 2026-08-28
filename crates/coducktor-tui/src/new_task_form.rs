//! The new-task composer's picker rules and request body. Every rule lives here as a pure
//! function and is covered by focused tests.
//!
//! Draft persistence (per-project, survives navigation for the lifetime of the
//! cockpit) lives on `App::new_task_drafts` — see `screens::new_task::sync_draft`.

use coducktor_contract::{
    ConfigResponse, ConversationGitMode, ConversationSkillSelection, CreateConversationInput,
    ImageInput, ProjectComposerDefaults, ProviderConnectionState, ProviderStatusResponse,
    ReasoningEffort, Runner, RunnerModelCatalogResponse, RunnerModels, RunnerSelection, Skill,
    runner_discovers_models,
};

/// The agent-backend catalog in stable `RUNNERS` order.
pub const RUNNERS: [Runner; 4] = [Runner::Claude, Runner::Codex, Runner::OpenCode, Runner::Pi];

/// Runners whose provider is both connected and enabled, in `RUNNERS` order.
pub fn usable_runners(status: Option<&ProviderStatusResponse>) -> Vec<Runner> {
    let Some(status) = status else {
        return Vec::new();
    };
    let usable: Vec<Runner> = status
        .providers
        .iter()
        .filter(|row| row.enabled == Some(true) && row.status == ProviderConnectionState::Connected)
        .map(|row| row.provider)
        .collect();
    RUNNERS
        .iter()
        .copied()
        .filter(|runner| usable.contains(runner))
        .collect()
}

/// A model option in a runner's picker — preset, host-discovered, or a pinned
/// custom/native id.
#[derive(Debug, Clone, PartialEq)]
pub struct ModelPreset {
    pub id: String,
    pub label: String,
    pub desc: String,
    pub reasoning_efforts: Option<Vec<String>>,
}

/// The static presets per runner. `id: ""` is always
/// "auto" — no model flag, the runner decides.
pub fn static_models_for(runner: Runner) -> Vec<ModelPreset> {
    let preset = |id: &'static str, label: &'static str, desc: &'static str| ModelPreset {
        id: id.to_owned(),
        label: label.to_owned(),
        desc: desc.to_owned(),
        reasoning_efforts: None,
    };
    match runner {
        Runner::Claude => vec![
            preset("", "auto", "Pick the best model per step"),
            preset("opus", "opus", "Deep reasoning for hard tasks"),
            preset("sonnet", "sonnet", "Fast and cheap"),
            preset("haiku", "haiku", "Fastest — simple, scoped tasks"),
            preset(
                "claude-fable-5",
                "Fable 5",
                "Most capable — the Claude 5 family",
            ),
            preset("claude-opus-4-8", "Opus 4.8", "Pinned version"),
            preset("claude-sonnet-5", "Sonnet 5", "Pinned version"),
            preset("claude-haiku-4-5", "Haiku 4.5", "Pinned version"),
        ],
        Runner::Codex | Runner::OpenCode => vec![preset("", "auto", "Use your default model")],
        Runner::Pi => vec![
            preset("", "auto", "Use your pi default model"),
            preset(
                "anthropic/claude-opus-4-8",
                "claude-opus-4.8",
                "via Anthropic",
            ),
            preset(
                "anthropic/claude-sonnet-5",
                "claude-sonnet-5",
                "via Anthropic",
            ),
            preset("openai/gpt-5.1", "gpt-5.1", "via OpenAI"),
        ],
    }
}

/// Runners that pick with the canonical `provider/model` convention and span every
/// provider the host has configured, so an id they list is never EXCLUSIVE to them.
const PROVIDER_SPANNING_RUNNERS: [Runner; 2] = [Runner::OpenCode, Runner::Pi];

/// Keep recognized presets from another backend out of a runner's custom-model
/// escape hatch (#480). Unknown ids remain valid custom models; only a known
/// cross-runner mismatch is discarded.
pub fn model_conflicts_with_runner(model: &str, runner: Runner) -> bool {
    if model.is_empty()
        || static_models_for(runner)
            .iter()
            .any(|preset| preset.id == model)
    {
        return false;
    }
    RUNNERS.iter().any(|other| {
        *other != runner
            && !PROVIDER_SPANNING_RUNNERS.contains(other)
            && static_models_for(*other)
                .iter()
                .any(|preset| !preset.id.is_empty() && preset.id == model)
    })
}

/// Build a runner's model list: static presets, then host-discovered models for the
/// discovery runners, then custom/native ids that are still representable.
pub fn models_for_runner(
    runner: Runner,
    catalog: Option<&RunnerModelCatalogResponse>,
    custom_ids: &[Option<&str>],
) -> Vec<ModelPreset> {
    let mut base = static_models_for(runner);
    let mut seen: std::collections::HashSet<String> =
        base.iter().map(|model| model.id.clone()).collect();
    if runner_discovers_models(runner) {
        for model in catalog
            .filter(|catalog| catalog.runner == runner)
            .map(|catalog| &catalog.models)
            .into_iter()
            .flatten()
        {
            if model.id.is_empty() || seen.contains(&model.id) {
                continue;
            }
            seen.insert(model.id.clone());
            base.push(ModelPreset {
                id: model.id.clone(),
                label: if model.label.is_empty() {
                    model.id.clone()
                } else {
                    model.label.clone()
                },
                desc: model.description.clone(),
                reasoning_efforts: model.reasoning_efforts.clone(),
            });
        }
    }
    for id in custom_ids.iter().flatten().filter(|id| !id.is_empty()) {
        if seen.contains(*id) || model_conflicts_with_runner(id, runner) {
            continue;
        }
        seen.insert((*id).to_owned());
        base.push(ModelPreset {
            id: (*id).to_owned(),
            label: (*id).to_owned(),
            desc: "Custom model".to_owned(),
            reasoning_efforts: None,
        });
    }
    base
}

/// The effective runner: the user's pick when still installed, else the configured default when
/// installed, else the first available.
pub fn resolve_runner(picked: Option<Runner>, available: &[Runner], preferred: Runner) -> Runner {
    if let Some(picked) = picked
        && available.contains(&picked)
    {
        return picked;
    }
    if available.contains(&preferred) {
        return preferred;
    }
    available.first().copied().unwrap_or(Runner::Claude)
}

/// `auto` is an authored policy, not a constructible backend. Preserve it for the
/// composer; concrete picker consumers keep using `resolve_runner`.
/// A conversation's harness is concrete and immutable, so the composer resolves an exact
/// runner: the user's pick when it is usable, else the configured default, else the first
/// usable backend. There is no Auto choice to route or fail over.
pub fn resolve_harness(picked: Option<Runner>, available: &[Runner], preferred: Runner) -> Runner {
    resolve_runner(picked, available, preferred)
}

/// Collapse a stored `RunnerSelection` default onto a concrete harness. Legacy configs may
/// still say `auto`; the composer treats that as "no opinion" and falls back to Claude.
pub fn harness_from_selection(selection: RunnerSelection) -> Runner {
    match selection {
        RunnerSelection::Auto | RunnerSelection::Claude => Runner::Claude,
        RunnerSelection::Codex => Runner::Codex,
        RunnerSelection::OpenCode => Runner::OpenCode,
        RunnerSelection::Pi => Runner::Pi,
    }
}

/// The effective model: the user's pick when it exists in the selected runner's
/// presets, else the configured per-runner default when IT is a known preset, else
/// auto (`""`). An explicit pick — including picking auto — always beats the
/// configured default.
pub fn resolve_model(
    picked: Option<&str>,
    runner: Runner,
    defaults: Option<&RunnerModels>,
    catalog: Option<&RunnerModelCatalogResponse>,
) -> String {
    let custom = [
        picked,
        defaults
            .and_then(|defaults| default_for_runner(defaults, runner))
            .map(|value| value.as_str()),
    ];
    let models = models_for_runner(runner, catalog, &custom);
    if let Some(picked) = picked
        && models.iter().any(|model| model.id == picked)
    {
        return picked.to_owned();
    }
    if let Some(preset) = defaults.and_then(|defaults| default_for_runner(defaults, runner))
        && models.iter().any(|model| model.id == *preset)
    {
        return preset.to_owned();
    }
    String::new()
}

fn default_for_runner(defaults: &RunnerModels, runner: Runner) -> Option<&String> {
    match runner {
        Runner::Claude => defaults.claude.as_ref(),
        Runner::Codex => defaults.codex.as_ref(),
        Runner::OpenCode => defaults.opencode.as_ref(),
        Runner::Pi => defaults.pi.as_ref(),
    }
}

/// One reasoning-level option in the picker.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReasoningOption {
    pub value: ReasoningEffort,
    pub label: &'static str,
    pub desc: &'static str,
}

pub fn reasoning_levels() -> Vec<ReasoningOption> {
    vec![
        ReasoningOption {
            value: ReasoningEffort::Auto,
            label: "auto",
            desc: "Choose per work chunk",
        },
        ReasoningOption {
            value: ReasoningEffort::Low,
            label: "Low",
            desc: "Fast, focused execution",
        },
        ReasoningOption {
            value: ReasoningEffort::Medium,
            label: "Medium",
            desc: "Balanced reasoning",
        },
        ReasoningOption {
            value: ReasoningEffort::High,
            label: "High",
            desc: "Careful reasoning for harder work",
        },
        ReasoningOption {
            value: ReasoningEffort::XHigh,
            label: "Max",
            desc: "Deepest available reasoning",
        },
    ]
}

/// The available reasoning choices for the currently selected model. Catalogs may
/// advertise a narrower native set; Auto remains available.
pub fn reasoning_options_for_model(model: &str, models: &[ModelPreset]) -> Vec<ReasoningOption> {
    let advertised = models
        .iter()
        .find(|entry| entry.id == model)
        .and_then(|entry| entry.reasoning_efforts.as_ref());
    let Some(advertised) = advertised else {
        return reasoning_levels();
    };
    let supported: Vec<&str> = advertised.iter().map(String::as_str).collect();
    reasoning_levels()
        .into_iter()
        .filter(|option| {
            option.value == ReasoningEffort::Auto
                || supported.contains(&reasoning_effort_id(option.value))
        })
        .collect()
}

fn reasoning_effort_id(effort: ReasoningEffort) -> &'static str {
    match effort {
        ReasoningEffort::Auto => "auto",
        ReasoningEffort::Low => "low",
        ReasoningEffort::Medium => "medium",
        ReasoningEffort::High => "high",
        ReasoningEffort::XHigh => "xhigh",
    }
}

/// Whether an attached skill still exists in the discovered catalog.
pub fn skill_exists(reference: &str, skills: &[Skill]) -> bool {
    skills.iter().any(|skill| skill.name == reference)
}

/// Drop attachments whose skill has disappeared from the catalog, preserving the user's
/// selection order. An empty catalog is treated as "not yet loaded" and left untouched so a
/// slow discovery pass cannot silently clear a draft's attachments.
pub fn retain_existing_skills(selected: &[String], skills: &[Skill]) -> Vec<String> {
    if skills.is_empty() {
        return selected.to_vec();
    }
    selected
        .iter()
        .filter(|reference| skill_exists(reference, skills))
        .cloned()
        .collect()
}

/// The assembled conversation-request options. Harness, model, reasoning, branch, worktree,
/// and Git mode become immutable conversation affinity; skills ride only this first message.
#[derive(Debug, Clone)]
pub struct CreateConversationOpts {
    pub project_id: String,
    pub text: String,
    pub images: Vec<ImageInput>,
    pub skills: Vec<String>,
    pub harness: Runner,
    pub model: String,
    pub reasoning_effort: Option<ReasoningEffort>,
    pub models_locked: bool,
    pub base_branch: Option<String>,
    pub worktree: bool,
    pub git_auto: bool,
}

/// The exact conversation-create body the composer sends. Empty picks are omitted rather than
/// sent as blank strings so the harness applies its own default.
pub fn build_create_conversation_input(opts: &CreateConversationOpts) -> CreateConversationInput {
    CreateConversationInput {
        project_id: opts.project_id.clone(),
        text: opts.text.clone(),
        images: opts.images.clone(),
        skills: opts
            .skills
            .iter()
            .map(|reference| ConversationSkillSelection {
                id: reference.clone(),
            })
            .collect(),
        harness: opts.harness,
        model: if opts.models_locked || opts.model.is_empty() {
            None
        } else {
            Some(opts.model.clone())
        },
        reasoning: opts
            .reasoning_effort
            .filter(|effort| *effort != ReasoningEffort::Auto)
            .map(|effort| reasoning_effort_id(effort).to_owned()),
        base_branch: opts
            .base_branch
            .as_ref()
            .filter(|branch| !branch.is_empty())
            .cloned(),
        worktree: opts.worktree,
        git_mode: if opts.git_auto {
            ConversationGitMode::Auto
        } else {
            ConversationGitMode::Manual
        },
    }
}

/// Where a successful create navigates: the new conversation's thread.
pub fn started_conversation_id(
    response: &coducktor_contract::CreateConversationResponse,
) -> String {
    response.conversation.id.clone()
}

/// Resolve the worktree and Git-mode pair in precedence order: hard constraints first, then
/// the explicit draft choice, then configured defaults. The two settings are independent —
/// git auto may run without a managed worktree, committing into the current checkout.
pub fn resolve_composer_git_mode(
    has_git: bool,
    explicit_worktree: Option<bool>,
    explicit_git_auto: Option<bool>,
    configured_worktree: bool,
    configured_git_auto: bool,
) -> (bool, bool) {
    if !has_git {
        return (false, false);
    }
    let worktree = explicit_worktree.unwrap_or(configured_worktree);
    let git_auto = explicit_git_auto.unwrap_or(configured_git_auto);
    (worktree, git_auto)
}

/// The config a project contributes to the composer's effective values.
#[derive(Debug, Clone)]
pub struct ComposerConfig {
    pub base_branch: Option<String>,
    pub default_harness: Runner,
    pub default_models: RunnerModels,
    pub composer_defaults: Option<ProjectComposerDefaults>,
    pub models_locked: bool,
}

impl Default for ComposerConfig {
    fn default() -> Self {
        Self {
            base_branch: None,
            default_harness: Runner::Claude,
            default_models: RunnerModels::default(),
            composer_defaults: None,
            models_locked: false,
        }
    }
}

impl ComposerConfig {
    pub fn from_config(config: &ConfigResponse) -> Self {
        Self {
            base_branch: config.base_branch.clone(),
            default_harness: harness_from_selection(config.default_runner),
            default_models: config.default_models.clone(),
            composer_defaults: config.composer_defaults.clone(),
            models_locked: config.models_locked,
        }
    }
}

/// The per-project new-task draft (port of `NewTaskDraft`). `None` fields mean
/// "the user has not chosen" — the form falls back to persisted/last-used/defaults.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct NewTaskDraft {
    pub text: String,
    /// Skill names attached to this message. Skills are additive per message rather than a
    /// mutually exclusive task source, so zero or more may be selected.
    pub skills: Vec<String>,
    pub harness: Option<Runner>,
    pub model: Option<String>,
    pub reasoning_effort: Option<ReasoningEffort>,
    pub worktree: Option<bool>,
    /// TUI-only override: pin automatic git commit/push on/off; `None` follows the workspace
    /// default.
    pub git_auto: Option<bool>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn skill(name: &str, source: coducktor_contract::SkillSource) -> Skill {
        Skill {
            name: name.to_owned(),
            description: None,
            interactive: None,
            body: String::new(),
            path: format!("/skills/{name}.md"),
            source,
        }
    }

    #[test]
    fn usable_runners_reads_the_provider_status() {
        let status = ProviderStatusResponse {
            providers: vec![
                coducktor_contract::ProviderStatus {
                    provider: Runner::Claude,
                    status: ProviderConnectionState::Connected,
                    enabled: Some(true),
                    hint: None,
                    auth_failure_id: None,
                    profile_id: None,
                },
                coducktor_contract::ProviderStatus {
                    provider: Runner::Codex,
                    status: ProviderConnectionState::Connected,
                    enabled: Some(false),
                    hint: None,
                    auth_failure_id: None,
                    profile_id: None,
                },
                coducktor_contract::ProviderStatus {
                    provider: Runner::OpenCode,
                    status: ProviderConnectionState::Disconnected,
                    enabled: Some(true),
                    hint: None,
                    auth_failure_id: None,
                    profile_id: None,
                },
            ],
        };
        assert_eq!(usable_runners(Some(&status)), vec![Runner::Claude]);
        assert!(usable_runners(None).is_empty());
    }

    #[test]
    fn resolve_runner_keeps_the_pick_while_installed() {
        assert_eq!(
            resolve_runner(
                Some(Runner::Codex),
                &[Runner::Claude, Runner::Codex],
                Runner::Claude
            ),
            Runner::Codex
        );
        assert_eq!(
            resolve_runner(
                Some(Runner::OpenCode),
                &[Runner::Claude, Runner::Codex],
                Runner::Codex
            ),
            Runner::Codex
        );
        assert_eq!(
            resolve_runner(None, &[Runner::Codex, Runner::OpenCode], Runner::Claude),
            Runner::Codex
        );
    }

    #[test]
    fn claude_model_catalog_has_stable_order() {
        let ids: Vec<String> = models_for_runner(Runner::Claude, None, &[])
            .into_iter()
            .map(|model| model.id)
            .collect();
        assert_eq!(
            ids,
            [
                "",
                "opus",
                "sonnet",
                "haiku",
                "claude-fable-5",
                "claude-opus-4-8",
                "claude-sonnet-5",
                "claude-haiku-4-5"
            ]
        );
    }

    #[test]
    fn codex_models_combine_auto_discovery_and_custom_ids() {
        let catalog = RunnerModelCatalogResponse {
            runner: Runner::Codex,
            models: vec![coducktor_contract::RunnerModelOption {
                id: "gpt-future".to_owned(),
                label: "Future".to_owned(),
                description: "New".to_owned(),
                reasoning_efforts: None,
            }],
            source: coducktor_contract::ModelCatalogSource::Live,
            stale: false,
            reason: None,
        };
        let ids: Vec<String> =
            models_for_runner(Runner::Codex, Some(&catalog), &[Some("legacy-id")])
                .into_iter()
                .map(|model| model.id)
                .collect();
        assert_eq!(ids, ["", "gpt-future", "legacy-id"]);
    }

    #[test]
    fn model_catalog_is_never_reused_for_another_runner() {
        let catalog = RunnerModelCatalogResponse {
            runner: Runner::Codex,
            models: vec![coducktor_contract::RunnerModelOption {
                id: "gpt-codex-only".to_owned(),
                label: "Codex only".to_owned(),
                description: String::new(),
                reasoning_efforts: None,
            }],
            source: coducktor_contract::ModelCatalogSource::Live,
            stale: false,
            reason: None,
        };
        let ids = models_for_runner(Runner::OpenCode, Some(&catalog), &[])
            .into_iter()
            .map(|model| model.id)
            .collect::<Vec<_>>();
        assert_eq!(ids, [""]);
    }

    #[test]
    fn reasoning_options_are_limited_to_the_advertised_set() {
        let models = vec![ModelPreset {
            id: "gpt-limited".to_owned(),
            label: "Limited".to_owned(),
            desc: String::new(),
            reasoning_efforts: Some(vec!["medium".to_owned()]),
        }];
        let options = reasoning_options_for_model("gpt-limited", &models);
        assert_eq!(
            options
                .iter()
                .map(|option| option.value)
                .collect::<Vec<_>>(),
            vec![ReasoningEffort::Auto, ReasoningEffort::Medium]
        );
        assert_eq!(
            reasoning_options_for_model("", &models)
                .into_iter()
                .map(|option| option.value)
                .collect::<Vec<_>>(),
            vec![
                ReasoningEffort::Auto,
                ReasoningEffort::Low,
                ReasoningEffort::Medium,
                ReasoningEffort::High,
                ReasoningEffort::XHigh,
            ]
        );
        assert_eq!(reasoning_levels()[0].label, "auto");
    }

    #[test]
    fn a_provider_spanning_runners_preset_is_never_another_runners_exclusive_model() {
        for model in ["openai/gpt-5.1", "anthropic/claude-sonnet-5"] {
            assert!(!model_conflicts_with_runner(model, Runner::OpenCode));
            assert!(!model_conflicts_with_runner(model, Runner::Pi));
        }
        assert!(model_conflicts_with_runner("opus", Runner::Codex));
    }

    #[test]
    fn resolve_model_keeps_known_picks_and_falls_back_to_defaults() {
        assert_eq!(
            resolve_model(Some("opus"), Runner::Claude, None, None),
            "opus"
        );
        assert_eq!(
            resolve_model(Some("custom-codex-id"), Runner::Codex, None, None),
            "custom-codex-id"
        );
        assert_eq!(resolve_model(None, Runner::Claude, None, None), "");
        let defaults = RunnerModels {
            claude: Some("opus".to_owned()),
            ..RunnerModels::default()
        };
        assert_eq!(
            resolve_model(None, Runner::Claude, Some(&defaults), None),
            "opus"
        );
        assert_eq!(
            resolve_model(Some("sonnet"), Runner::Claude, Some(&defaults), None),
            "sonnet"
        );
        assert_eq!(
            resolve_model(Some(""), Runner::Claude, Some(&defaults), None),
            ""
        );
    }

    #[test]
    fn attachments_drop_only_skills_that_disappeared_from_a_loaded_catalog() {
        let catalog = vec![
            skill("review", coducktor_contract::SkillSource::Agents),
            skill("triage", coducktor_contract::SkillSource::Global),
        ];
        let selected = vec!["review".to_owned(), "gone".to_owned(), "triage".to_owned()];
        assert_eq!(
            retain_existing_skills(&selected, &catalog),
            vec!["review".to_owned(), "triage".to_owned()],
            "selection order survives the filter"
        );
        assert_eq!(
            retain_existing_skills(&selected, &[]),
            selected,
            "an unloaded catalog must not silently clear a draft"
        );
    }

    #[test]
    fn harness_resolution_is_concrete_and_never_auto() {
        let available = [Runner::Codex, Runner::Pi];
        assert_eq!(
            resolve_harness(Some(Runner::Pi), &available, Runner::Codex),
            Runner::Pi,
            "an installed pick wins"
        );
        assert_eq!(
            resolve_harness(Some(Runner::Claude), &available, Runner::Codex),
            Runner::Codex,
            "an unavailable pick falls back to the configured default"
        );
        assert_eq!(
            harness_from_selection(RunnerSelection::Auto),
            Runner::Claude,
            "a legacy auto default collapses to a concrete harness"
        );
        assert_eq!(
            harness_from_selection(RunnerSelection::OpenCode),
            Runner::OpenCode
        );
    }

    fn base_opts() -> CreateConversationOpts {
        CreateConversationOpts {
            project_id: "proj".to_owned(),
            text: "ship the login fix".to_owned(),
            images: Vec::new(),
            skills: Vec::new(),
            harness: Runner::Claude,
            model: String::new(),
            reasoning_effort: None,
            models_locked: false,
            base_branch: Some("main".to_owned()),
            worktree: true,
            git_auto: false,
        }
    }

    #[test]
    fn a_plain_message_sends_only_its_exact_text_and_affinity() {
        let input = build_create_conversation_input(&base_opts());
        assert_eq!(input.project_id, "proj");
        assert_eq!(input.text, "ship the login fix");
        assert_eq!(input.harness, Runner::Claude);
        assert!(input.skills.is_empty());
        assert_eq!(input.model, None, "auto omits the model flag");
        assert_eq!(input.reasoning, None);
        assert_eq!(input.base_branch.as_deref(), Some("main"));
        assert!(input.worktree);
        assert_eq!(input.git_mode, ConversationGitMode::Manual);
    }

    #[test]
    fn skills_ride_the_message_as_ordered_attachments() {
        let mut opts = base_opts();
        opts.skills = vec!["review".to_owned(), "triage".to_owned()];
        let input = build_create_conversation_input(&opts);
        assert_eq!(
            input
                .skills
                .iter()
                .map(|selection| selection.id.as_str())
                .collect::<Vec<_>>(),
            vec!["review", "triage"]
        );
    }

    #[test]
    fn explicit_model_and_reasoning_are_sent_but_auto_and_locked_are_omitted() {
        let mut opts = base_opts();
        opts.model = "opus".to_owned();
        opts.reasoning_effort = Some(ReasoningEffort::High);
        let input = build_create_conversation_input(&opts);
        assert_eq!(input.model.as_deref(), Some("opus"));
        assert_eq!(input.reasoning.as_deref(), Some("high"));

        opts.reasoning_effort = Some(ReasoningEffort::Auto);
        assert_eq!(build_create_conversation_input(&opts).reasoning, None);

        opts.models_locked = true;
        assert_eq!(build_create_conversation_input(&opts).model, None);
    }

    #[test]
    fn git_auto_rides_as_the_conversations_git_mode() {
        let mut opts = base_opts();
        opts.git_auto = true;
        assert_eq!(
            build_create_conversation_input(&opts).git_mode,
            ConversationGitMode::Auto
        );
    }

    #[test]
    fn images_ride_along_with_the_first_message() {
        let mut opts = base_opts();
        opts.images = vec![ImageInput {
            media_type: "image/png".to_owned(),
            data: "abc".to_owned(),
        }];
        assert_eq!(build_create_conversation_input(&opts).images.len(), 1);
    }

    #[test]
    fn worktree_and_git_auto_resolve_independently() {
        // Worktree off no longer downgrades an explicit git auto.
        assert_eq!(
            resolve_composer_git_mode(true, Some(false), Some(true), true, false),
            (false, true)
        );
        assert_eq!(
            resolve_composer_git_mode(true, Some(true), Some(true), false, false),
            (true, true)
        );
        assert_eq!(
            resolve_composer_git_mode(true, None, None, true, true),
            (true, true),
            "configured defaults apply when the draft is untouched"
        );
        assert_eq!(
            resolve_composer_git_mode(false, Some(true), Some(true), true, true),
            (false, false),
            "a non-Git project has neither a worktree nor automatic commits"
        );
    }
}
