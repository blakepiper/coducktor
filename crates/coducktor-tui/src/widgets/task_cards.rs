//! Shared grouped conversation-card list used by project Chats and workspace All Chats.

use coducktor_protocol::ToolKind;
use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph};
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

use crate::glyphs::{glyphs, tool_icon, unicode_supported};
use crate::input::hitmap::{HitAction, HitMap};
use crate::theme::Theme;
use crate::widgets::card::{
    CARD_CHROME_WIDTH, Card, CardSection, CardState as FrameState, MIN_CARD_WIDTH,
};

pub const BODY_MAX_ROWS: u16 = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum CardGroup {
    NeedsYou,
    Working,
    Recent,
    Archived,
}

impl CardGroup {
    fn label(self) -> &'static str {
        match self {
            Self::NeedsYou => "NEEDS YOU",
            Self::Working => "WORKING",
            Self::Recent => "RECENT",
            Self::Archived => "ARCHIVED",
        }
    }
}

/// What a browser card is doing. This single value drives its icon, border, fill, and badge.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CardState {
    NeedsInput,
    Running,
    Queued,
    Idle,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone)]
pub enum CardChip {
    Harness {
        harness: String,
        model: Option<String>,
        reasoning: Option<String>,
    },
    Branch(String),
    Worktree(String),
    PullRequest(u64),
    Project(String),
    Custom(String),
}

#[derive(Debug, Clone)]
pub struct TaskCard {
    pub key: String,
    pub group: CardGroup,
    pub state: CardState,
    pub title: String,
    pub body: String,
    pub age: String,
    pub chips: Vec<CardChip>,
    pub unread: bool,
}

/// Optional action shown at the far right of the first visible group heading.
pub struct CardHeaderAction<'a> {
    pub label: &'a str,
    pub focused: bool,
    pub action: HitAction,
}

/// The non-duplicated body for a card whose title came from the same prompt.
pub fn body_after_title(title: &str, prompt: &str) -> String {
    let title = collapse_whitespace(
        title
            .trim()
            .trim_end_matches('…')
            .trim_end_matches('.')
            .trim_end(),
    );
    let prompt = collapse_whitespace(prompt);
    let Some(remainder) = prompt.strip_prefix(&title) else {
        return prompt;
    };
    let remainder = remainder.trim_start_matches(|character: char| {
        character.is_whitespace()
            || matches!(
                character,
                '.' | ',' | ':' | ';' | '!' | '?' | '—' | '–' | '-'
            )
    });
    if remainder.chars().count() < 3 {
        String::new()
    } else {
        remainder.to_owned()
    }
}

fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Rows this card needs at `width`: two borders, up to three body rows, and one chip row.
pub fn card_height(card: &TaskCard, width: u16) -> u16 {
    2_u16
        .saturating_add(wrapped_body(&card.body, content_width(width)).len() as u16)
        .saturating_add(u16::from(!card.chips.is_empty()))
}

/// Render whole cards only. `scroll` remains a card index even though cards have variable height.
#[allow(clippy::too_many_arguments)]
pub fn render(
    frame: &mut Frame<'_>,
    area: Rect,
    cards: &[TaskCard],
    selected: Option<usize>,
    scroll: &mut usize,
    hitmap: &mut HitMap,
    title: Line<'static>,
    empty_hint: &str,
    theme: &Theme,
    animation_tick: u64,
    header_action: Option<CardHeaderAction<'_>>,
) {
    let outer = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(theme.palette.card_quiet_border))
        .title(title);
    let inner = outer.inner(area);
    frame.render_widget(outer, area);
    if cards.is_empty() {
        *scroll = 0;
        render_empty(frame, inner, hitmap, empty_hint, theme, header_action);
        return;
    }

    let card_width = inner.width.saturating_sub(1);
    fit_scroll(cards, selected, scroll, card_width, inner.height);

    let mut y = inner.y;
    let mut previous_group = None;
    let mut header_action = header_action;
    for (index, card) in cards.iter().enumerate().skip(*scroll) {
        let group_changed = previous_group != Some(card.group);
        let height = card_height(card, card_width);
        let leading_rows =
            u16::from(index > *scroll).saturating_add(if group_changed { 2 } else { 0 });
        if y.saturating_add(leading_rows).saturating_add(height) > inner.bottom() {
            break;
        }
        if index > *scroll {
            y = y.saturating_add(1);
        }
        if group_changed {
            let count = cards.iter().filter(|item| item.group == card.group).count();
            render_group_rule(
                frame,
                Rect::new(inner.x, y, inner.width, 1),
                card.group,
                count,
                theme,
                header_action.take(),
                hitmap,
            );
            y = y.saturating_add(2);
            previous_group = Some(card.group);
        }
        let card_area = Rect::new(inner.x.saturating_add(1), y, card_width, height);
        if selected == Some(index) {
            let rail = Rect::new(inner.x, y, 1, height);
            frame.render_widget(
                Paragraph::new(
                    std::iter::repeat_n(
                        if unicode_supported() { "▎" } else { "|" },
                        usize::from(height),
                    )
                    .collect::<Vec<_>>()
                    .join("\n"),
                )
                .style(Style::default().fg(theme.palette.accent)),
                rail,
            );
        }
        render_card(frame, card_area, card, theme, animation_tick);
        hitmap.register(
            Rect::new(inner.x, y, inner.width, height),
            2,
            HitAction::TableRow(index),
        );
        y = y.saturating_add(height);
    }
}

fn fit_scroll(
    cards: &[TaskCard],
    selected: Option<usize>,
    scroll: &mut usize,
    width: u16,
    height: u16,
) {
    *scroll = (*scroll).min(cards.len().saturating_sub(1));
    let Some(selected) = selected.filter(|index| *index < cards.len()) else {
        return;
    };
    if selected < *scroll {
        *scroll = selected;
    }
    while *scroll < selected && visible_bottom(cards, *scroll, selected, width) > height {
        *scroll += 1;
    }
}

fn visible_bottom(cards: &[TaskCard], start: usize, end: usize, width: u16) -> u16 {
    let mut rows = 0_u16;
    let mut previous_group = None;
    for (index, card) in cards.iter().enumerate().take(end + 1).skip(start) {
        if index > start {
            rows = rows.saturating_add(1);
        }
        if previous_group != Some(card.group) {
            rows = rows.saturating_add(2);
            previous_group = Some(card.group);
        }
        rows = rows.saturating_add(card_height(card, width));
    }
    rows
}

fn render_card(frame: &mut Frame<'_>, area: Rect, card: &TaskCard, theme: &Theme, tick: u64) {
    let body = wrapped_body(&card.body, content_width(area.width));
    let mut lines: Vec<Line<'static>> = body
        .into_iter()
        .map(|text| {
            Line::from(Span::styled(
                text,
                Style::default().fg(theme.palette.soft_fg),
            ))
        })
        .collect();
    if !card.chips.is_empty() {
        lines.push(chip_line(&card.chips, content_width(area.width), theme));
    }
    Card {
        header: card_header(card, area.width, tick, theme),
        meta: vec![card.age.clone()],
        state: frame_state(card.state),
        sections: if lines.is_empty() {
            Vec::new()
        } else {
            vec![CardSection { label: None, lines }]
        },
    }
    .render(frame.buffer_mut(), area, theme);
}

fn frame_state(state: CardState) -> FrameState {
    match state {
        CardState::NeedsInput => FrameState::Pending,
        CardState::Running => FrameState::Running,
        CardState::Queued => FrameState::Queued,
        CardState::Idle => FrameState::Idle,
        CardState::Failed => FrameState::Error,
        CardState::Cancelled => FrameState::Cancelled,
    }
}

fn card_header(card: &TaskCard, width: u16, tick: u64, theme: &Theme) -> Vec<Span<'static>> {
    let tone = state_color(card.state, theme);
    let icon = match card.state {
        CardState::NeedsInput => glyphs().pending,
        CardState::Running => crate::widgets::spinner::status_frame(tick),
        CardState::Queued => glyphs().collapsed,
        CardState::Idle => glyphs().bullet,
        CardState::Failed => glyphs().error,
        CardState::Cancelled => glyphs().warning,
    };
    let badge = state_badge(card.state);
    let badge_width = badge.as_ref().map_or(0, |value| value.width() + 1);
    let unread_width = usize::from(card.unread) * 2;
    let fixed = 2_usize + unread_width + badge_width;
    let maximum = usize::from(width)
        .saturating_sub(card.age.width())
        .saturating_sub(9);
    let title_width = maximum.saturating_sub(fixed);
    let mut spans = vec![Span::styled(
        format!("{icon} "),
        Style::default().fg(tone).add_modifier(Modifier::BOLD),
    )];
    if card.unread {
        spans.push(Span::styled(
            format!("{} ", if unicode_supported() { "●" } else { "*" }),
            Style::default()
                .fg(theme.palette.accent)
                .add_modifier(Modifier::BOLD),
        ));
    }
    spans.push(Span::styled(
        truncate_to_width(&card.title, title_width),
        Style::default()
            .fg(theme.palette.fg)
            .add_modifier(if card.unread {
                Modifier::BOLD
            } else {
                Modifier::empty()
            }),
    ));
    if let Some(badge) = badge {
        spans.push(Span::styled(
            format!(" {badge}"),
            Style::default().fg(tone).add_modifier(Modifier::BOLD),
        ));
    }
    spans
}

fn state_color(state: CardState, theme: &Theme) -> Color {
    match state {
        CardState::NeedsInput => theme.palette.waiting,
        CardState::Running => theme.palette.accent,
        CardState::Queued => theme.palette.queued,
        CardState::Idle => theme.palette.card_quiet_border,
        CardState::Failed => theme.palette.failed,
        CardState::Cancelled => theme.palette.cancelled,
    }
}

fn state_badge(state: CardState) -> Option<String> {
    let label = match state {
        CardState::NeedsInput => "needs you",
        CardState::Queued => "queued",
        CardState::Failed => "failed",
        CardState::Cancelled => "cancelled",
        CardState::Running | CardState::Idle => return None,
    };
    Some(format!(
        "{}{label}{}",
        glyphs().bracket_left,
        glyphs().bracket_right
    ))
}

fn content_width(width: u16) -> usize {
    usize::from(if width < MIN_CARD_WIDTH {
        width
    } else {
        width.saturating_sub(CARD_CHROME_WIDTH)
    })
}

fn wrapped_body(body: &str, width: usize) -> Vec<String> {
    if width == 0 || body.trim().is_empty() {
        return Vec::new();
    }
    let mut rows = Vec::new();
    let mut row = String::new();
    for word in body.split_whitespace() {
        let separator = usize::from(!row.is_empty());
        if row
            .width()
            .saturating_add(separator)
            .saturating_add(word.width())
            <= width
        {
            if separator == 1 {
                row.push(' ');
            }
            row.push_str(word);
        } else {
            if !row.is_empty() {
                rows.push(std::mem::take(&mut row));
                if rows.len() == usize::from(BODY_MAX_ROWS) {
                    break;
                }
            }
            row.push_str(&truncate_to_width(word, width));
        }
    }
    if rows.len() < usize::from(BODY_MAX_ROWS) && !row.is_empty() {
        rows.push(row);
    }
    rows
}

fn truncate_to_width(value: &str, width: usize) -> String {
    if value.width() <= width {
        return value.to_owned();
    }
    if width == 0 {
        return String::new();
    }
    let ellipsis = if unicode_supported() { "…" } else { "." };
    let target = width.saturating_sub(ellipsis.width());
    let mut result = String::new();
    let mut used = 0_usize;
    for character in value.chars() {
        let character_width = character.width().unwrap_or(0);
        if used.saturating_add(character_width) > target {
            break;
        }
        result.push(character);
        used += character_width;
    }
    result.push_str(ellipsis);
    result
}

fn chip_line(chips: &[CardChip], width: usize, theme: &Theme) -> Line<'static> {
    let rendered: Vec<Vec<Span<'static>>> =
        chips.iter().map(|chip| chip_spans(chip, theme)).collect();
    let mut kept = rendered.len();
    while kept > 0 {
        let used = rendered[..kept]
            .iter()
            .map(|chip| chip.iter().map(Span::width).sum::<usize>())
            .sum::<usize>()
            .saturating_add(kept.saturating_sub(1) * 2);
        let dropped = rendered.len() - kept;
        let overflow = if dropped == 0 {
            0
        } else {
            2 + format!("+{dropped}").width()
        };
        if used.saturating_add(overflow) <= width {
            break;
        }
        kept -= 1;
    }
    let mut spans = Vec::new();
    for (index, chip) in rendered.into_iter().take(kept).enumerate() {
        if index > 0 {
            spans.push(Span::raw("  "));
        }
        spans.extend(chip);
    }
    let dropped = chips.len() - kept;
    if dropped > 0 {
        if kept > 0 {
            spans.push(Span::raw("  "));
        }
        spans.push(Span::styled(
            format!("+{dropped}"),
            Style::default()
                .fg(theme.palette.soft_fg)
                .add_modifier(Modifier::DIM),
        ));
    }
    Line::from(spans)
}

fn chip_spans(chip: &CardChip, theme: &Theme) -> Vec<Span<'static>> {
    let soft = Style::default().fg(theme.palette.soft_fg);
    match chip {
        CardChip::Harness {
            harness,
            model,
            reasoning,
        } => {
            let mut spans = vec![
                Span::styled(format!("{} ", tool_icon(ToolKind::Execute)), soft),
                Span::styled(harness.clone(), Style::default().fg(theme.palette.accent)),
            ];
            if let Some(model) = model {
                spans.push(Span::styled(
                    glyphs().separator,
                    soft.add_modifier(Modifier::DIM),
                ));
                spans.push(Span::styled(model.clone(), soft));
            }
            if let Some(reasoning) = reasoning {
                spans.push(Span::styled(
                    glyphs().separator,
                    soft.add_modifier(Modifier::DIM),
                ));
                spans.push(Span::styled(reasoning.clone(), soft));
            }
            spans
        }
        CardChip::Branch(value) => vec![Span::styled(
            format!("{} {value}", if unicode_supported() { "⑂" } else { "br" }),
            soft,
        )],
        CardChip::Worktree(value) => vec![Span::styled(
            format!("{} {value}", if unicode_supported() { "⌂" } else { "wt" }),
            soft,
        )],
        CardChip::PullRequest(number) => vec![Span::styled(
            format!("{} #{number}", if unicode_supported() { "⇅" } else { "PR" }),
            Style::default().fg(theme.palette.review),
        )],
        CardChip::Project(value) => vec![Span::styled(
            format!("{} {value}", glyphs().collapsed),
            Style::default().fg(theme.palette.accent),
        )],
        CardChip::Custom(value) => vec![Span::styled(value.clone(), soft)],
    }
}

fn render_group_rule(
    frame: &mut Frame<'_>,
    area: Rect,
    group: CardGroup,
    count: usize,
    theme: &Theme,
    action: Option<CardHeaderAction<'_>>,
    hitmap: &mut HitMap,
) {
    let action_width = action
        .as_ref()
        .map_or(0, |action| action.label.chars().count() as u16 + 2);
    let available = area.width.saturating_sub(action_width);
    let set = glyphs();
    let left_rule = set.horizontal.repeat(2);
    let label = format!(" {}", group.label());
    let count_text = format!(" · {count} ");
    let used = left_rule
        .width()
        .saturating_add(label.width())
        .saturating_add(count_text.width());
    let mut spans = vec![
        Span::styled(
            left_rule,
            Style::default().fg(theme.palette.card_quiet_border),
        ),
        Span::styled(
            label,
            Style::default()
                .fg(theme.palette.soft_fg)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            count_text,
            Style::default()
                .fg(theme.palette.soft_fg)
                .add_modifier(Modifier::DIM),
        ),
        Span::styled(
            set.horizontal
                .repeat(usize::from(available).saturating_sub(used)),
            Style::default().fg(theme.palette.card_quiet_border),
        ),
    ];
    if available == 0 {
        spans.clear();
    }
    frame.render_widget(Paragraph::new(Line::from(spans)), area);
    render_header_action(frame, area, hitmap, theme, action);
}

fn render_empty(
    frame: &mut Frame<'_>,
    area: Rect,
    hitmap: &mut HitMap,
    hint: &str,
    theme: &Theme,
    action: Option<CardHeaderAction<'_>>,
) {
    if area.height == 0 {
        return;
    }
    let y = area
        .y
        .saturating_add(area.height.saturating_sub(u16::from(action.is_some()) + 1) / 2);
    frame.render_widget(
        Paragraph::new(hint)
            .style(Style::default().fg(theme.palette.soft_fg))
            .centered(),
        Rect::new(area.x, y, area.width, 1),
    );
    if let Some(action) = action {
        let label = format!("[{}]", action.label);
        let width = label.width().min(usize::from(area.width)) as u16;
        let rect = Rect::new(
            area.x.saturating_add(area.width.saturating_sub(width) / 2),
            y.saturating_add(1),
            width,
            1,
        );
        let style = if action.focused {
            Style::default()
                .fg(theme.palette.accent)
                .add_modifier(Modifier::BOLD | Modifier::REVERSED)
        } else {
            Style::default().fg(theme.palette.accent)
        };
        frame.render_widget(Paragraph::new(label).style(style), rect);
        hitmap.register(rect, 4, action.action);
    }
}

fn render_header_action(
    frame: &mut Frame<'_>,
    area: Rect,
    hitmap: &mut HitMap,
    theme: &Theme,
    action: Option<CardHeaderAction<'_>>,
) {
    let Some(action) = action else {
        return;
    };
    let label = format!("[{}]", action.label);
    let width = label.width() as u16;
    if area.height == 0 || width > area.width {
        return;
    }
    let rect = Rect::new(area.right().saturating_sub(width), area.y, width, 1);
    let style = if action.focused {
        Style::default()
            .fg(theme.palette.accent)
            .add_modifier(Modifier::BOLD | Modifier::REVERSED)
    } else {
        Style::default().fg(theme.palette.accent)
    };
    frame.render_widget(Paragraph::new(label).style(style), rect);
    hitmap.register(rect, 4, action.action);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::theme::{ColorCapability, ThemeName};

    fn theme() -> Theme {
        Theme::new(ThemeName::Dark, ColorCapability::TrueColor)
    }

    fn card(index: usize, body: &str, chips: bool) -> TaskCard {
        TaskCard {
            key: index.to_string(),
            group: CardGroup::Recent,
            state: CardState::Idle,
            title: format!("Chat {index}"),
            body: body.to_owned(),
            age: "13h".to_owned(),
            chips: if chips {
                vec![CardChip::Harness {
                    harness: "opencode".to_owned(),
                    model: Some("opencode-go/glm-5.3-flash".to_owned()),
                    reasoning: Some("high".to_owned()),
                }]
            } else {
                Vec::new()
            },
            unread: false,
        }
    }

    #[test]
    fn prompt_remainder_does_not_repeat_the_screenshot_title() {
        let title = "We need animations for \"the harness is working\"…";
        let prompt = "We need animations for \"the harness is working\" seen inside the thread \
            view and for the 'running' state when looking at all the chats.";
        assert_eq!(
            body_after_title(title, prompt),
            "seen inside the thread view and for the 'running' state when looking at all the chats."
        );
        assert_eq!(body_after_title("Ship it", "Ship it."), "");
    }

    #[test]
    fn card_height_tracks_only_visible_content() {
        assert_eq!(card_height(&card(0, "", false), 80), 2);
        assert_eq!(card_height(&card(0, "", true), 80), 3);
        let height = card_height(
            &card(
                0,
                "A long body that wraps across several rows without growing beyond the cap.",
                true,
            ),
            24,
        );
        assert_eq!(height, 6);
    }

    #[test]
    fn state_controls_card_chrome_badges_and_animation() {
        let theme = theme();
        let mut running = card(0, "working", false);
        running.state = CardState::Running;
        let area = Rect::new(0, 0, 80, card_height(&running, 80));
        let mut buffer = ratatui::buffer::Buffer::empty(area);
        render_card_in_buffer(&mut buffer, area, &running, &theme, 3);
        let text: String = buffer.content.iter().map(|cell| cell.symbol()).collect();
        assert!(text.contains(crate::widgets::spinner::status_frame(3)));
        assert_eq!(buffer[(0, 0)].fg, theme.palette.accent);
        assert_eq!(buffer[(1, 1)].bg, theme.palette.card_pending_bg);

        let mut failed = card(1, "", false);
        failed.state = CardState::Failed;
        let area = Rect::new(0, 0, 80, card_height(&failed, 80));
        let mut buffer = ratatui::buffer::Buffer::empty(area);
        render_card_in_buffer(&mut buffer, area, &failed, &theme, 0);
        let text: String = buffer.content.iter().map(|cell| cell.symbol()).collect();
        assert!(text.contains(&state_badge(CardState::Failed).unwrap()));
        assert_eq!(buffer[(0, 0)].fg, theme.palette.failed);

        let idle = card(2, "", false);
        let area = Rect::new(0, 0, 80, card_height(&idle, 80));
        let mut buffer = ratatui::buffer::Buffer::empty(area);
        render_card_in_buffer(&mut buffer, area, &idle, &theme, 0);
        let text: String = buffer.content.iter().map(|cell| cell.symbol()).collect();
        assert!(!text.contains("idle"));
    }

    fn render_card_in_buffer(
        buffer: &mut ratatui::buffer::Buffer,
        area: Rect,
        card: &TaskCard,
        theme: &Theme,
        tick: u64,
    ) {
        let body = wrapped_body(&card.body, content_width(area.width));
        let lines = body.into_iter().map(Line::from).collect();
        Card {
            header: card_header(card, area.width, tick, theme),
            meta: vec![card.age.clone()],
            state: frame_state(card.state),
            sections: vec![CardSection { label: None, lines }],
        }
        .render(buffer, area, theme);
    }

    #[test]
    fn typed_chips_keep_affinity_fields_separate_and_drop_whole_chips() {
        let theme = theme();
        let chips = vec![
            CardChip::Harness {
                harness: "opencode".to_owned(),
                model: Some("opencode-go/glm-5.3-flash".to_owned()),
                reasoning: Some("high".to_owned()),
            },
            CardChip::Branch("duck/chat-18c".to_owned()),
            CardChip::PullRequest(42),
        ];
        let full = chip_line(&chips, 120, &theme).to_string();
        assert!(full.contains("opencode"));
        assert!(full.contains("opencode-go/glm-5.3-flash"));
        assert!(full.contains("high"));
        assert!(!full.contains("opencode/opencode-go"));

        let narrow = chip_line(&chips, 60, &theme).to_string();
        assert!(narrow.contains("+2"));
        assert!(!narrow.contains("duck/chat-18c"));
    }

    #[test]
    fn selected_last_card_is_fully_visible_at_reference_heights() {
        let cards: Vec<_> = (0..20)
            .map(|index| card(index, "short body", true))
            .collect();
        for height in [10, 24, 60] {
            let mut scroll = 0;
            fit_scroll(&cards, Some(cards.len() - 1), &mut scroll, 78, height);
            assert!(
                visible_bottom(&cards, scroll, cards.len() - 1, 78) <= height,
                "height {height}, scroll {scroll}"
            );
        }
    }
}
