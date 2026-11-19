use crate::error::{ApiError, ApiResult};
use unicode_segmentation::UnicodeSegmentation;

pub const NOTE_LIMIT: usize = 500;
pub const SEARCH_LIMIT: usize = 100;

pub const NOTE_TOO_LONG: &str = "Note is longer than 500 characters";
pub const SEARCH_TOO_LONG: &str = "Search text is longer than 100 characters";

/// Characters as people count them: extended grapheme clusters, so an emoji
/// with a skin tone, a flag, a family emoji or an accented letter counts as one.
pub fn grapheme_count(text: &str) -> usize {
    text.graphemes(true).count()
}

/// Notes and questions are stored exactly as sent, with no trimming.
pub fn check_note(field: &str, value: &str) -> ApiResult<()> {
    if grapheme_count(value) > NOTE_LIMIT {
        return Err(ApiError::validation(field, NOTE_TOO_LONG));
    }
    Ok(())
}

pub fn check_question(value: &str) -> ApiResult<()> {
    if value.trim().is_empty() {
        return Err(ApiError::validation("question", "A question is required"));
    }
    if grapheme_count(value) > NOTE_LIMIT {
        return Err(ApiError::validation("question", NOTE_TOO_LONG));
    }
    Ok(())
}
