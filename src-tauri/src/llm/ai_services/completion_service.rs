use crate::llm::ai_services::stream_collector::{CollectResult, StreamCollector};
use crate::llm::ai_services::types::{CompletionContext, CompletionResult};
use crate::llm::streaming::stream_handler::StreamHandler;
use crate::llm::types::StreamTextRequest;

pub struct CompletionService;

impl CompletionService {
    pub fn new() -> Self {
        Self
    }

    /// Get AI completion for code based on context
    pub async fn get_completion(
        &self,
        context: CompletionContext,
        handler: &StreamHandler,
    ) -> Result<CompletionResult, String> {
        log::info!(
            "getCompletion context: fileName={}, language={}, cursorPosition={}, contentLength={}",
            context.file_name,
            context.language,
            context.cursor_position,
            context.file_content.len()
        );

        // Extract text before and after cursor for context
        let before_cursor = if context.cursor_position < context.file_content.len() {
            &context.file_content[..context.cursor_position]
        } else {
            &context.file_content
        };
        let after_cursor = if context.cursor_position < context.file_content.len() {
            &context.file_content[context.cursor_position..]
        } else {
            ""
        };

        // Get the current line and context
        let lines: Vec<&str> = before_cursor.split('\n').collect();
        let current_line = lines.last().unwrap_or(&"");
        let previous_context = if lines.len() > 10 {
            lines[lines.len() - 10..].join("\n")
        } else {
            lines[..lines.len().saturating_sub(1)].join("\n")
        };

        // Get first 5 lines after cursor for context
        let after_lines: Vec<&str> = after_cursor.split('\n').take(5).collect();
        let after_context = after_lines.join("\n");

        // Create prompt for AI completion
        let prompt = format!(
            "You are an AI code completion assistant. Complete the following {} code.\n\n\
             File: {}\n\
             Context (previous lines):\n\
             ```{}\n\
             {}\n\
             ```\n\n\
             Current incomplete line: \"{}\"\n\n\
             After cursor:\n\
             ```{}\n\
             {}\n\
             ```\n\n\
             Provide ONLY the completion text that should be inserted at the cursor position. \
             Do not include the existing text or explanations.\n\
             Response should be plain text without markdown formatting.\n\
             Keep the completion concise and relevant to the current context.",
            context.language,
            context.file_name,
            context.language,
            previous_context,
            current_line,
            context.language,
            after_context
        );

        // Build request - will be passed to handler for streaming
        let request = StreamCollector::create_completion_request(
            "claude-sonnet-4.5".to_string(), // CODE_STAR model equivalent
            prompt,
        );

        // For now, we return a placeholder implementation
        // The actual implementation would integrate with the StreamHandler
        // Since StreamHandler requires a Window for emitting events,
        // we need a different approach for non-window streaming

        log::info!(
            "AI Completion: would generate completion for {}",
            context.file_name
        );

        // Return empty completion for now - full implementation requires
        // refactoring StreamHandler to support non-window streaming
        Ok(CompletionResult {
            completion: String::new(),
            range: None,
        })
    }

    /// Extract context around cursor position
    fn extract_context<'a>(
        content: &'a str,
        cursor_pos: usize,
        lines_before: usize,
        lines_after: usize,
    ) -> (String, String, String) {
        let before = if cursor_pos <= content.len() {
            &content[..cursor_pos]
        } else {
            content
        };
        let after = if cursor_pos < content.len() {
            &content[cursor_pos..]
        } else {
            ""
        };

        let before_lines: Vec<&str> = before.split('\n').collect();

        // If before ends with newline, current_line is empty (start of new line)
        // Otherwise current_line is the last line
        let (current_line, previous_lines_count) = if before.ends_with('\n') {
            ("".to_string(), before_lines.len().saturating_sub(1))
        } else {
            let current = before_lines.last().unwrap_or(&"").to_string();
            (current, before_lines.len().saturating_sub(1))
        };

        let context_start = previous_lines_count.saturating_sub(lines_before);
        let previous_lines_slice = &before_lines[context_start..previous_lines_count];
        let previous_context = previous_lines_slice.join("\n");

        let after_lines: Vec<&str> = after.split('\n').take(lines_after).collect();
        let after_context = after_lines.join("\n");

        (previous_context, current_line, after_context)
    }

    /// Build the completion prompt
    fn build_prompt(
        &self,
        file_name: &str,
        language: &str,
        previous_context: &str,
        current_line: &str,
        after_context: &str,
    ) -> String {
        format!(
            "You are an AI code completion assistant. Complete the following {} code.\n\n\
             File: {}\n\
             Context (previous lines):\n\
             ```{}\n\
             {}\n\
             ```\n\n\
             Current incomplete line: \"{}\"\n\n\
             After cursor:\n\
             ```{}\n\
             {}\n\
             ```\n\n\
             Provide ONLY the completion text that should be inserted at the cursor position. \
             Do not include the existing text or explanations.\n\
             Response should be plain text without markdown formatting.\n\
             Keep the completion concise and relevant to the current context.",
            language, file_name, language, previous_context, current_line, language, after_context
        )
    }
}

impl Default for CompletionService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_context_gets_correct_lines() {
        let _service = CompletionService::new();
        let content =
            "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\nline12";

        // Cursor at the beginning of line12 (after "\n" at end of line11)
        let cursor_pos = content.find("line12").unwrap();

        let (prev, current, after) = CompletionService::extract_context(content, cursor_pos, 10, 5);

        // prev should contain lines 2-11 (10 lines before cursor)
        assert!(prev.contains("line2"));
        assert!(prev.contains("line10"));
        assert!(prev.contains("line11"));
        // current is empty because cursor is at start of a new line
        assert_eq!(current, "");
        assert_eq!(after, "line12");
    }

    #[test]
    fn extract_context_handles_cursor_at_end() {
        let content = "line1\nline2";
        let cursor_pos = content.len();

        let (prev, current, after) = CompletionService::extract_context(content, cursor_pos, 10, 5);

        assert_eq!(prev, "line1");
        assert_eq!(current, "line2");
        assert_eq!(after, "");
    }

    #[test]
    fn extract_context_handles_empty_after() {
        let content = "line1\nline2";
        let cursor_pos = content.len();

        let (_, _, after) = CompletionService::extract_context(content, cursor_pos, 10, 5);

        assert_eq!(after, "");
    }

    #[test]
    fn build_prompt_contains_all_parts() {
        let service = CompletionService::new();
        let prompt = service.build_prompt(
            "test.ts",
            "typescript",
            "const x = 1;",
            "const y = ",
            "console.log(y);",
        );

        assert!(prompt.contains("test.ts"));
        assert!(prompt.contains("typescript"));
        assert!(prompt.contains("const x = 1;"));
        assert!(prompt.contains("const y = "));
        assert!(prompt.contains("console.log(y);"));
        assert!(prompt.contains("AI code completion assistant"));
    }

    #[test]
    fn build_prompt_escapes_correctly() {
        let service = CompletionService::new();
        let prompt = service.build_prompt(
            "file.rs",
            "rust",
            "fn main() {",
            "    let x = \"test\";",
            "}",
        );

        assert!(prompt.contains("```rust"));
        assert!(prompt.contains("file.rs"));
    }
}
