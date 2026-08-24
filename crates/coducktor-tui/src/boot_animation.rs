//! The one-shot geometric animation played over the cockpit on interactive launch.
//!
//! Three regular polygons (a triangle, a hexagon, and a dodecagon) counter-rotate around a
//! shared center while their radius eases open, holds, and eases shut again, like a camera
//! iris or a cockpit display powering on. The `coducktor` wordmark types itself in once the
//! rings are open, in the same spot the real header renders it, so the cut to the normal UI
//! reads as a continuation rather than a scene change.
//!
//! This only ever runs from `runtime::entry` via [`App::start_boot_animation`] — `App::new`
//! leaves it off, so none of the existing screen snapshot tests render a frame of it.

use std::f64::consts::TAU;

use ratatui::Frame;
use ratatui::layout::{Alignment, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::symbols::Marker;
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::widgets::canvas::{Canvas, Context, Line as CanvasLine};

use crate::theme::Theme;

const WORDMARK: &str = "coducktor";

/// Ticks (at the app's ~33ms frame budget) spent easing the rings open, then shut.
const OPEN_TICKS: u64 = 12;
const CLOSE_TICKS: u64 = 12;
/// Ticks the rings hold fully open before closing.
const HOLD_TICKS: u64 = 12;
const TOTAL_TICKS: u64 = OPEN_TICKS + HOLD_TICKS + CLOSE_TICKS;
/// The wordmark starts typing in once the rings are most of the way open, and finishes
/// within the open phase so it has settled before the hold begins.
const REVEAL_START_TICK: u64 = OPEN_TICKS.saturating_sub(4);
const REVEAL_TICKS: u64 = WORDMARK.len() as u64;

/// Smallest terminal the animation bothers with; below this it never starts.
const MIN_WIDTH: u16 = 24;
const MIN_HEIGHT: u16 = 8;

pub struct BootAnimation {
    start_tick: u64,
}

impl BootAnimation {
    pub fn start(now_tick: u64) -> Self {
        Self {
            start_tick: now_tick,
        }
    }

    pub fn fits(area: Rect) -> bool {
        area.width >= MIN_WIDTH && area.height >= MIN_HEIGHT
    }

    pub fn is_finished(&self, now_tick: u64) -> bool {
        now_tick.saturating_sub(self.start_tick) >= TOTAL_TICKS
    }

    pub fn render(&self, frame: &mut Frame<'_>, area: Rect, theme: &Theme, now_tick: u64) {
        let elapsed = now_tick.saturating_sub(self.start_tick);
        let bloom = bloom_factor(elapsed);
        let accent = theme.palette.accent;
        let soft = theme.palette.soft_fg;
        let spin = elapsed as f64;

        // Braille cells pack 2x4 dots each; matching the world-unit span to that pixel grid
        // keeps the rings round instead of squashed to the terminal's tall, narrow cells.
        let width_px = f64::from(area.width) * 2.0;
        let height_px = f64::from(area.height) * 4.0;
        let aspect = if height_px > 0.0 {
            width_px / height_px
        } else {
            1.0
        };
        let half_y = 46.0_f64.min(height_px / 2.0).max(1.0);
        let half_x = half_y * aspect;

        let canvas = Canvas::default()
            .marker(Marker::Braille)
            .background_color(theme.palette.bg)
            .x_bounds([-half_x, half_x])
            .y_bounds([-half_y, half_y])
            .paint(move |ctx| {
                if bloom < 0.999 {
                    draw_spokes(ctx, 12, 34.0 * bloom, spin * 0.09, soft);
                }
                draw_polygon(ctx, 12, 34.0 * bloom, spin * 0.09, accent);
                draw_polygon(ctx, 6, 22.0 * bloom, -spin * 0.16, soft);
                draw_polygon(ctx, 3, 11.0 * bloom, spin * 0.24, accent);
            });
        frame.render_widget(canvas, area);

        if elapsed >= REVEAL_START_TICK {
            render_wordmark(frame, area, accent, elapsed - REVEAL_START_TICK);
        }
    }
}

/// 0.0..=1.0 over the open phase, holds at 1.0, then eases back to 0.0 over the close phase.
fn bloom_factor(elapsed: u64) -> f64 {
    if elapsed < OPEN_TICKS {
        ease_out_cubic(elapsed as f64 / OPEN_TICKS as f64)
    } else if elapsed < OPEN_TICKS + HOLD_TICKS {
        1.0
    } else {
        let closing = TOTAL_TICKS.saturating_sub(elapsed);
        ease_out_cubic(closing as f64 / CLOSE_TICKS as f64)
    }
}

fn ease_out_cubic(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    1.0 - (1.0 - t).powi(3)
}

fn draw_polygon(ctx: &mut Context<'_>, sides: u32, radius: f64, rotation: f64, color: Color) {
    if radius < 0.5 {
        return;
    }
    let vertex = |index: u32| {
        let angle = rotation + (f64::from(index) / f64::from(sides)) * TAU;
        (radius * angle.cos(), radius * angle.sin())
    };
    for index in 0..sides {
        let (x1, y1) = vertex(index);
        let (x2, y2) = vertex(index + 1);
        ctx.draw(&CanvasLine {
            x1,
            y1,
            x2,
            y2,
            color,
        });
    }
}

/// Thin lines from the center out to each vertex, only drawn while the rings are opening or
/// closing, for a brief burst-of-light look that clears once the rings settle.
fn draw_spokes(ctx: &mut Context<'_>, sides: u32, radius: f64, rotation: f64, color: Color) {
    if radius < 0.5 {
        return;
    }
    for index in 0..sides {
        let angle = rotation + (f64::from(index) / f64::from(sides)) * TAU;
        ctx.draw(&CanvasLine {
            x1: 0.0,
            y1: 0.0,
            x2: radius * angle.cos(),
            y2: radius * angle.sin(),
            color,
        });
    }
}

/// Renders the wordmark centered where the real header's brand text sits, typing in one
/// letter at a time as `revealed_ticks` advances.
fn render_wordmark(frame: &mut Frame<'_>, area: Rect, accent: Color, revealed_ticks: u64) {
    let shown = usize::try_from(revealed_ticks.min(REVEAL_TICKS)).unwrap_or(WORDMARK.len());
    if shown == 0 {
        return;
    }
    let text = &WORDMARK[..shown];
    let line = Line::from(Span::styled(
        text,
        Style::default().fg(accent).add_modifier(Modifier::BOLD),
    ));
    let row = area.y + area.height / 2;
    let label_area = Rect::new(area.x, row, area.width, 1);
    frame.render_widget(
        Paragraph::new(line).alignment(Alignment::Center),
        label_area,
    );
}
