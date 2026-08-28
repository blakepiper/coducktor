use std::env;

use ratatui::style::Color;

/// The supported named themes. There is deliberately no system theme.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThemeName {
    Dark,
    LazyVim,
    Lakes,
}

impl ThemeName {
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "dark" => Some(Self::Dark),
            "lazyvim" | "lazy-vim" => Some(Self::LazyVim),
            "lakes" | "lakes-and-light" => Some(Self::Lakes),
            _ => None,
        }
    }

    pub const fn label(self) -> &'static str {
        match self {
            Self::Dark => "dark",
            Self::LazyVim => "lazyvim",
            Self::Lakes => "lakes",
        }
    }

    /// Whether this theme's surfaces are dark, used to pick a matching syntax-highlighting
    /// palette (e.g. so `Lakes`'s light parchment background doesn't pair with foreground
    /// colors meant for a dark terminal).
    pub const fn is_dark(self) -> bool {
        match self {
            Self::Dark | Self::LazyVim => true,
            Self::Lakes => false,
        }
    }
}

/// Terminal color capability detected at startup.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColorCapability {
    TrueColor,
    Ansi256,
    Ansi16,
}

impl ColorCapability {
    pub fn detect() -> Self {
        let color_term = env::var("COLORTERM")
            .unwrap_or_default()
            .to_ascii_lowercase();
        if color_term == "truecolor" || color_term == "24bit" {
            return Self::TrueColor;
        }
        if env::var("TERM")
            .unwrap_or_default()
            .to_ascii_lowercase()
            .contains("256")
        {
            Self::Ansi256
        } else {
            Self::Ansi16
        }
    }

    fn color(self, rgb: (u8, u8, u8), indexed: u8, ansi: u8) -> Color {
        match self {
            Self::TrueColor => Color::Rgb(rgb.0, rgb.1, rgb.2),
            Self::Ansi256 => Color::Indexed(indexed),
            Self::Ansi16 => Color::Indexed(ansi),
        }
    }
}

/// Semantic colors used by the shell and later screens.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ThemePalette {
    pub bg: Color,
    pub surface: Color,
    pub border: Color,
    pub fg: Color,
    pub soft_fg: Color,
    pub accent: Color,
    pub add: Color,
    pub del: Color,
    pub queued: Color,
    pub running: Color,
    pub waiting: Color,
    pub review: Color,
    pub done: Color,
    pub failed: Color,
    pub cancelled: Color,
    /// Card fill while a tool is pending or running.
    pub card_pending_bg: Color,
    /// Card fill for a finished, successful tool.
    pub card_success_bg: Color,
    /// Card fill for a failed tool.
    pub card_error_bg: Color,
    /// Border for a finished card, kept quieter than live-card borders.
    pub card_quiet_border: Color,
}

/// A named palette plus the capability used to quantize it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Theme {
    pub name: ThemeName,
    pub capability: ColorCapability,
    pub palette: ThemePalette,
}

impl Theme {
    pub fn detect() -> Self {
        Self::new(ThemeName::LazyVim, ColorCapability::detect())
    }

    pub fn new(name: ThemeName, capability: ColorCapability) -> Self {
        let palette = match name {
            ThemeName::Dark => palette(
                capability,
                (20, 22, 25),
                (29, 32, 36),
                (61, 66, 74),
                (235, 238, 242),
                (157, 164, 174),
                (168, 216, 80),
            ),
            ThemeName::LazyVim => palette(
                capability,
                (26, 27, 38),
                (36, 40, 59),
                (65, 72, 104),
                (192, 202, 245),
                (130, 139, 184),
                (122, 162, 247),
            ),
            ThemeName::Lakes => lakes_palette(capability),
        };
        Self {
            name,
            capability,
            palette,
        }
    }
}

/// Lakes & Light's parchment and sepia palette, adapted from its Omarchy theme.
fn lakes_palette(capability: ColorCapability) -> ThemePalette {
    ThemePalette {
        bg: capability.color((245, 228, 216), 224, 15),
        surface: capability.color((246, 231, 220), 224, 15),
        border: capability.color((184, 171, 162), 248, 8),
        fg: capability.color((58, 25, 17), 52, 0),
        soft_fg: capability.color((127, 121, 116), 243, 8),
        accent: capability.color((128, 95, 54), 95, 3),
        add: capability.color((139, 95, 15), 94, 2),
        del: capability.color((86, 43, 0), 52, 1),
        queued: capability.color((127, 121, 116), 243, 8),
        running: capability.color((128, 95, 54), 95, 3),
        waiting: capability.color((123, 85, 33), 94, 3),
        review: capability.color((86, 56, 25), 52, 5),
        done: capability.color((101, 62, 0), 58, 2),
        failed: capability.color((86, 43, 0), 52, 1),
        cancelled: capability.color((127, 121, 116), 243, 8),
        card_pending_bg: card_color(capability, blend((245, 228, 216), (128, 95, 54), 0.06), 254),
        card_success_bg: card_color(capability, (246, 231, 220), 254),
        card_error_bg: card_color(capability, blend((245, 228, 216), (86, 43, 0), 0.08), 224),
        card_quiet_border: card_color(
            capability,
            blend((245, 228, 216), (184, 171, 162), 0.65),
            250,
        ),
    }
}

fn palette(
    capability: ColorCapability,
    bg: (u8, u8, u8),
    surface: (u8, u8, u8),
    border: (u8, u8, u8),
    fg: (u8, u8, u8),
    soft_fg: (u8, u8, u8),
    accent: (u8, u8, u8),
) -> ThemePalette {
    ThemePalette {
        bg: capability.color(bg, 235, 0),
        surface: capability.color(surface, 236, 0),
        border: capability.color(border, 240, 8),
        fg: capability.color(fg, 255, 15),
        soft_fg: capability.color(soft_fg, 245, 7),
        accent: capability.color(accent, 113, 10),
        add: capability.color((120, 200, 120), 78, 2),
        del: capability.color((240, 110, 110), 203, 1),
        queued: capability.color((145, 150, 165), 245, 7),
        running: capability.color((100, 180, 255), 75, 12),
        waiting: capability.color((245, 190, 80), 178, 11),
        review: capability.color((190, 130, 245), 141, 13),
        done: capability.color((120, 205, 135), 78, 2),
        failed: capability.color((245, 105, 105), 203, 1),
        cancelled: capability.color((125, 130, 140), 243, 8),
        card_pending_bg: card_color(capability, blend(bg, accent, 0.10), 236),
        card_success_bg: card_color(capability, surface, 236),
        card_error_bg: card_color(capability, blend(bg, (240, 110, 110), 0.14), 52),
        card_quiet_border: card_color(capability, blend(bg, border, 0.65), 238),
    }
}

/// Mix `top` into `base` at `alpha`.
fn blend(base: (u8, u8, u8), top: (u8, u8, u8), alpha: f32) -> (u8, u8, u8) {
    let mix = |base: u8, top: u8| {
        (f32::from(base) + (f32::from(top) - f32::from(base)) * alpha).round() as u8
    };
    (mix(base.0, top.0), mix(base.1, top.1), mix(base.2, top.2))
}

fn card_color(capability: ColorCapability, rgb: (u8, u8, u8), indexed: u8) -> Color {
    match capability {
        ColorCapability::TrueColor => Color::Rgb(rgb.0, rgb.1, rgb.2),
        ColorCapability::Ansi256 => Color::Indexed(indexed),
        ColorCapability::Ansi16 => Color::Reset,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_supported_named_themes() {
        assert_eq!(ThemeName::parse("dark"), Some(ThemeName::Dark));
        assert_eq!(ThemeName::parse("lazy-vim"), Some(ThemeName::LazyVim));
        assert_eq!(ThemeName::parse("lakes-and-light"), Some(ThemeName::Lakes));
        assert_eq!(ThemeName::parse("system"), None);
    }

    #[test]
    fn lakes_uses_the_source_parchment_and_umber_colors() {
        let theme = Theme::new(ThemeName::Lakes, ColorCapability::TrueColor);
        assert_eq!(theme.palette.bg, Color::Rgb(245, 228, 216));
        assert_eq!(theme.palette.fg, Color::Rgb(58, 25, 17));
        assert_eq!(theme.palette.accent, Color::Rgb(128, 95, 54));
    }

    #[test]
    fn detects_lazyvim_as_the_default_theme() {
        assert_eq!(Theme::detect().name, ThemeName::LazyVim);
    }

    #[test]
    fn capability_changes_color_representation() {
        assert!(matches!(
            Theme::new(ThemeName::Dark, ColorCapability::TrueColor)
                .palette
                .bg,
            Color::Rgb(..)
        ));
        assert!(matches!(
            Theme::new(ThemeName::Dark, ColorCapability::Ansi256)
                .palette
                .bg,
            Color::Indexed(235)
        ));
    }
}
