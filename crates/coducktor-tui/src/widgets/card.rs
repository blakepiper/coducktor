//! Shared framed card used by transcript tools and conversation lists.

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Paragraph, Widget};
use unicode_width::UnicodeWidthStr;

use crate::glyphs::{Glyphs, glyphs};
use crate::theme::Theme;

/// Below this width the chrome costs more than it conveys.
pub const MIN_CARD_WIDTH: u16 = 24;
/// Columns consumed by `│ ` + ` │`.
pub const CARD_CHROME_WIDTH: u16 = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CardState {
    Pending,
    Running,
    Success,
    Warning,
    Error,
}

impl CardState {
    pub fn border(self, theme: &Theme) -> Color {
        match self {
            Self::Error => theme.palette.failed,
            Self::Warning => theme.palette.waiting,
            Self::Pending | Self::Running => theme.palette.accent,
            Self::Success => theme.palette.card_quiet_border,
        }
    }

    pub fn fill(self, theme: &Theme) -> Color {
        match self {
            Self::Pending | Self::Running => theme.palette.card_pending_bg,
            Self::Error => theme.palette.card_error_bg,
            Self::Success | Self::Warning => theme.palette.card_success_bg,
        }
    }
}

/// One labelled run of body rows.
pub struct CardSection<'a> {
    pub label: Option<Span<'a>>,
    pub lines: Vec<Line<'a>>,
}

pub struct Card<'a> {
    /// Rendered inside the top border after `╭───`.
    pub header: Vec<Span<'a>>,
    /// Right-aligned dim meta inside the top border.
    pub meta: Vec<String>,
    pub state: CardState,
    pub sections: Vec<CardSection<'a>>,
}

impl<'a> Card<'a> {
    pub fn height(&self, width: u16) -> u16 {
        if width < MIN_CARD_WIDTH {
            return self.plain_height();
        }
        let mut rows = 2_u16;
        for (index, section) in self.sections.iter().enumerate() {
            if section.label.is_some() || index > 0 {
                rows = rows.saturating_add(1);
            }
            rows = rows.saturating_add(section.lines.len().try_into().unwrap_or(u16::MAX));
        }
        rows
    }

    fn plain_height(&self) -> u16 {
        1_u16.saturating_add(
            self.sections
                .iter()
                .map(|section| u16::try_from(section.lines.len()).unwrap_or(u16::MAX))
                .fold(0_u16, u16::saturating_add),
        )
    }

    pub fn render(&self, buf: &mut Buffer, area: Rect, theme: &Theme) {
        self.render_with_glyphs(buf, area, theme, glyphs());
    }

    fn render_with_glyphs(&self, buf: &mut Buffer, area: Rect, theme: &Theme, set: Glyphs) {
        let height = self.height(area.width).min(area.height);
        if area.width == 0 || height == 0 {
            return;
        }
        let area = Rect { height, ..area };
        self.fill(buf, area, theme);
        if area.width < MIN_CARD_WIDTH {
            self.render_plain(buf, area, theme);
            return;
        }

        let border = Style::default().fg(self.state.border(theme));
        paint_line(
            buf,
            row(area, 0),
            self.top_bar(area.width, theme, set, border),
        );

        let mut y = 1_u16;
        for (index, section) in self.sections.iter().enumerate() {
            if section.label.is_some() || index > 0 {
                if y >= area.height {
                    break;
                }
                paint_line(
                    buf,
                    row(area, y),
                    divider(area.width, section.label.clone(), set, border),
                );
                y = y.saturating_add(1);
            }
            for line in &section.lines {
                if y >= area.height.saturating_sub(1) {
                    break;
                }
                paint_body_line(buf, row(area, y), line.clone(), set, border);
                y = y.saturating_add(1);
            }
        }
        if area.height > 1 {
            paint_line(
                buf,
                row(area, area.height - 1),
                bottom_bar(area.width, set, border),
            );
        }
    }

    pub fn render_folded(&self, buf: &mut Buffer, area: Rect, theme: &Theme) {
        if area.width == 0 || area.height == 0 {
            return;
        }
        let area = Rect {
            height: area.height.min(2),
            ..area
        };
        self.fill(buf, area, theme);
        let set = glyphs();
        let border = Style::default().fg(self.state.border(theme));
        let mut spans = vec![Span::styled(
            format!("{}{} ", set.top_left, set.horizontal),
            border,
        )];
        spans.extend(self.header.iter().cloned());
        append_meta(&mut spans, &self.meta, theme, set, area.width, 3);
        paint_line(buf, row(area, 0), Line::from(spans));
        if area.height > 1 {
            paint_line(
                buf,
                row(area, 1),
                Line::from(Span::styled(set.bottom_left, border)),
            );
        }
    }

    pub fn render_summary(&self, icon: &str, buf: &mut Buffer, area: Rect, theme: &Theme) {
        if area.width == 0 || area.height == 0 {
            return;
        }
        let area = Rect { height: 1, ..area };
        self.fill(buf, area, theme);
        let mut spans = if icon.is_empty() {
            Vec::new()
        } else {
            vec![Span::styled(
                format!("{icon} "),
                Style::default().fg(self.state.border(theme)),
            )]
        };
        spans.extend(self.header.iter().cloned());
        append_meta(&mut spans, &self.meta, theme, glyphs(), area.width, 2);
        paint_line(buf, area, Line::from(spans));
    }

    fn fill(&self, buf: &mut Buffer, area: Rect, theme: &Theme) {
        let fill = self.state.fill(theme);
        if fill != Color::Reset {
            buf.set_style(area, Style::default().bg(fill));
        }
    }

    fn render_plain(&self, buf: &mut Buffer, area: Rect, theme: &Theme) {
        let mut y = 0_u16;
        let mut header = self.header.clone();
        append_meta(&mut header, &self.meta, theme, glyphs(), area.width, 0);
        paint_line(buf, row(area, y), Line::from(header));
        y = y.saturating_add(1);
        for section in &self.sections {
            for line in &section.lines {
                if y >= area.height {
                    return;
                }
                paint_line(buf, row(area, y), line.clone());
                y = y.saturating_add(1);
            }
        }
    }

    fn top_bar(&self, width: u16, theme: &Theme, set: Glyphs, border: Style) -> Line<'a> {
        let header_width = self.header.iter().map(Span::width).sum::<usize>();
        let meta = self.meta.join(set.separator);
        let meta_width = UnicodeWidthStr::width(meta.as_str());
        let show_meta =
            !meta.is_empty() && header_width.saturating_add(meta_width) + 9 <= usize::from(width);
        let fixed = 7_usize + header_width + if show_meta { meta_width + 2 } else { 0 };
        let fill = usize::from(width).saturating_sub(fixed);
        let mut spans = vec![Span::styled(
            format!("{}{} ", set.top_left, set.horizontal.repeat(3)),
            border,
        )];
        spans.extend(self.header.iter().cloned());
        spans.push(Span::raw(" "));
        spans.push(Span::styled(set.horizontal.repeat(fill), border));
        if show_meta {
            spans.push(Span::raw(" "));
            spans.push(Span::styled(
                meta,
                Style::default()
                    .fg(theme.palette.soft_fg)
                    .add_modifier(Modifier::DIM),
            ));
            spans.push(Span::raw(" "));
        }
        spans.push(Span::styled(set.top_right, border));
        Line::from(spans)
    }
}

fn row(area: Rect, offset: u16) -> Rect {
    Rect::new(area.x, area.y.saturating_add(offset), area.width, 1)
}

fn paint_line(buf: &mut Buffer, area: Rect, line: Line<'_>) {
    if area.width > 0 && area.height > 0 {
        Paragraph::new(line).render(area, buf);
    }
}

fn paint_body_line(buf: &mut Buffer, area: Rect, line: Line<'_>, set: Glyphs, border: Style) {
    if area.width < CARD_CHROME_WIDTH {
        paint_line(buf, area, line);
        return;
    }
    paint_line(
        buf,
        Rect::new(area.x, area.y, 1, 1),
        Line::from(Span::styled(set.vertical, border)),
    );
    paint_line(
        buf,
        Rect::new(
            area.x.saturating_add(2),
            area.y,
            area.width.saturating_sub(CARD_CHROME_WIDTH),
            1,
        ),
        line,
    );
    paint_line(
        buf,
        Rect::new(area.x.saturating_add(area.width - 1), area.y, 1, 1),
        Line::from(Span::styled(set.vertical, border)),
    );
}

fn divider<'a>(width: u16, label: Option<Span<'a>>, set: Glyphs, border: Style) -> Line<'a> {
    let mut spans = vec![Span::styled(
        format!("{}{}", set.tee_right, set.horizontal.repeat(3)),
        border,
    )];
    if let Some(label) = label {
        let label_width = label.width();
        spans.push(Span::raw(" "));
        spans.push(label);
        spans.push(Span::raw(" "));
        let fill = usize::from(width).saturating_sub(label_width + 7);
        spans.push(Span::styled(set.horizontal.repeat(fill), border));
    } else {
        spans.push(Span::styled(
            set.horizontal.repeat(usize::from(width).saturating_sub(5)),
            border,
        ));
    }
    spans.push(Span::styled(set.tee_left, border));
    Line::from(spans)
}

fn bottom_bar(width: u16, set: Glyphs, border: Style) -> Line<'static> {
    Line::from(vec![
        Span::styled(set.bottom_left, border),
        Span::styled(
            set.horizontal.repeat(usize::from(width).saturating_sub(2)),
            border,
        ),
        Span::styled(set.bottom_right, border),
    ])
}

fn append_meta<'a>(
    spans: &mut Vec<Span<'a>>,
    meta: &[String],
    theme: &Theme,
    set: Glyphs,
    width: u16,
    fixed: usize,
) {
    if meta.is_empty() {
        return;
    }
    let text = meta.join(set.separator);
    let occupied = spans.iter().map(Span::width).sum::<usize>();
    if occupied + UnicodeWidthStr::width(text.as_str()) + fixed > usize::from(width) {
        return;
    }
    spans.push(Span::styled(
        format!("{}{}", set.separator, text),
        Style::default()
            .fg(theme.palette.soft_fg)
            .add_modifier(Modifier::DIM),
    ));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::glyphs::glyphs_for;
    use crate::theme::{ColorCapability, Theme, ThemeName};

    fn fixture() -> Card<'static> {
        Card {
            header: vec![Span::raw("Ran tests")],
            meta: vec!["2.4s".to_owned()],
            state: CardState::Success,
            sections: vec![
                CardSection {
                    label: None,
                    lines: vec![Line::from("$ cargo test")],
                },
                CardSection {
                    label: Some(Span::raw("Output")),
                    lines: vec![Line::from("12 passed"), Line::from("done")],
                },
            ],
        }
    }

    fn buffer_rows(buf: &Buffer) -> Vec<String> {
        (buf.area.y..buf.area.bottom())
            .map(|y| {
                (buf.area.x..buf.area.right())
                    .map(|x| buf[(x, y)].symbol())
                    .collect()
            })
            .collect()
    }

    #[test]
    fn renders_exact_borders_and_output_divider() {
        let theme = Theme::new(ThemeName::Dark, ColorCapability::TrueColor);
        let area = Rect::new(0, 0, 60, fixture().height(60));
        let mut buf = Buffer::empty(area);
        fixture().render_with_glyphs(&mut buf, area, &theme, glyphs_for(true));
        let rows = buffer_rows(&buf);
        assert_eq!(
            rows[0],
            "╭─── Ran tests ────────────────────────────────────── 2.4s ╮"
        );
        assert_eq!(
            rows[2],
            "├─── Output ───────────────────────────────────────────────┤"
        );
        assert_eq!(
            rows[5],
            "╰──────────────────────────────────────────────────────────╯"
        );
    }

    #[test]
    fn measured_height_matches_every_painted_row() {
        let theme = Theme::new(ThemeName::Dark, ColorCapability::TrueColor);
        for width in [10, 24, 40, 80, 200] {
            let card = fixture();
            let height = card.height(width);
            let area = Rect::new(0, 0, width, height);
            let mut buf = Buffer::empty(area);
            card.render(&mut buf, area, &theme);
            let painted = buffer_rows(&buf)
                .into_iter()
                .filter(|row| !row.trim().is_empty())
                .count();
            assert_eq!(painted, usize::from(height), "width {width}");
        }
    }

    #[test]
    fn ascii_chrome_keeps_identical_height() {
        let theme = Theme::new(ThemeName::Dark, ColorCapability::Ansi16);
        let card = fixture();
        let area = Rect::new(0, 0, 60, card.height(60));
        let mut buf = Buffer::empty(area);
        card.render_with_glyphs(&mut buf, area, &theme, glyphs_for(false));
        let rows = buffer_rows(&buf);
        assert!(rows[0].starts_with("+--- Ran tests "));
        assert!(rows[2].starts_with("+--- Output "));
        assert_eq!(card.height(60), 6);
    }
}
