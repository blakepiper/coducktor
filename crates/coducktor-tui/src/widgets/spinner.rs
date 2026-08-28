//! Shared spinner frames driven by the per-frame `App::animation_tick`.
//!
//! The runtime redraws every ~33 ms and increments the tick once per frame, so any
//! render site can derive the current animation frame from the tick alone — no timers,
//! no stored frame state.

/// Braille dot patterns ordered as a continuous clockwise spin.
pub const FRAMES: [&str; 8] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"];
/// Heavier braille used inside bordered tool and conversation cards.
pub const STATUS_FRAMES: [&str; 8] = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];
/// Sparkle cycle for the thinking indicator.
pub const THINKING_FRAMES: [&str; 8] = ["✻", "✼", "❉", "❊", "✺", "✹", "✸", "✶"];
pub const ASCII_FRAMES: [&str; 4] = ["|", "/", "-", "\\"];

/// The frame for `tick`. Three ticks (~100 ms) per frame keeps the spin readable
/// at the ~30 fps redraw rate.
pub fn frame(tick: u64) -> &'static str {
    if crate::glyphs::unicode_supported() {
        FRAMES[(tick as usize / 3) % FRAMES.len()]
    } else {
        ascii_frame(tick, 3)
    }
}

pub fn status_frame(tick: u64) -> &'static str {
    if crate::glyphs::unicode_supported() {
        STATUS_FRAMES[(tick as usize / 3) % STATUS_FRAMES.len()]
    } else {
        ascii_frame(tick, 3)
    }
}

pub fn thinking_frame(tick: u64) -> &'static str {
    if crate::glyphs::unicode_supported() {
        THINKING_FRAMES[(tick as usize / 4) % THINKING_FRAMES.len()]
    } else {
        ascii_frame(tick, 4)
    }
}

pub fn pulse(tick: u64) -> f32 {
    let phase = (tick / 4) % THINKING_FRAMES.len() as u64;
    let t = phase as f32 / THINKING_FRAMES.len() as f32;
    (1.0 - (std::f32::consts::TAU * t).cos()) / 2.0
}

fn ascii_frame(tick: u64, ticks_per_frame: u64) -> &'static str {
    ASCII_FRAMES[((tick / ticks_per_frame) as usize) % ASCII_FRAMES.len()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_frame_cycles_through_every_pattern() {
        let frames: Vec<&str> = (0..FRAMES.len() as u64)
            .map(|index| frame(index * 3))
            .collect();
        assert_eq!(frames, FRAMES);
    }

    #[test]
    fn the_sequence_is_stable_and_wraps() {
        assert_eq!(frame(0), FRAMES[0]);
        assert_eq!(frame(2), FRAMES[0]);
        assert_eq!(frame(3), FRAMES[1]);
        let total = FRAMES.len() as u64 * 3;
        assert_eq!(frame(total), frame(0), "the cycle wraps without drift");
    }

    #[test]
    fn status_and_thinking_cycles_are_shared_clock_functions() {
        assert_eq!(status_frame(0), STATUS_FRAMES[0]);
        assert_eq!(status_frame(3), STATUS_FRAMES[1]);
        assert_eq!(thinking_frame(4), THINKING_FRAMES[1]);
        assert!((pulse(0) - 0.0).abs() < f32::EPSILON);
        assert!((pulse(16) - 1.0).abs() < f32::EPSILON);
    }
}
