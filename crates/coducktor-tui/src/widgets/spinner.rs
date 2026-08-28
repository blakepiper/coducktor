//! Shared spinner frames driven by the per-frame `App::animation_tick`.
//!
//! The runtime redraws every ~33 ms and increments the tick once per frame, so any
//! render site can derive the current animation frame from the tick alone — no timers,
//! no stored frame state.

/// Braille dot patterns ordered as a continuous clockwise spin.
pub const FRAMES: [&str; 8] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"];

/// The frame for `tick`. Three ticks (~100 ms) per frame keeps the spin readable
/// at the ~30 fps redraw rate.
pub fn frame(tick: u64) -> &'static str {
    FRAMES[(tick as usize / 3) % FRAMES.len()]
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
}
