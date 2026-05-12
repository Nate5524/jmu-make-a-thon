export function normalizeAssistantContent(content) {
  if (content == null) return "";
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && (b.type === "text" || b.text))
      .map((b) => (typeof b.text === "string" ? b.text : ""))
      .join("")
      .trim();
  }
  return String(content).trim();
}

/**
 * @param {Array<{ role: string, content?: string, tool_calls?: unknown, tool_call_id?: string }>} messages
 * @param {object} chatOptions
 * @param {(name: string, args: object) => Promise<unknown>} dispatchJarvisTool
 * @param {{ chat: (messages: unknown[], options: object) => Promise<unknown> }} puterAi
 */
export async function completeJarvisWithTools(messages, chatOptions, dispatchJarvisTool, puterAi) {
  const maxToolRounds = 10;
  let response = await puterAi.chat(messages, chatOptions);
  for (let round = 0; round < maxToolRounds; round++) {
    const msg = response && response.message;
    if (!msg) break;
    const toolCalls = msg.tool_calls;
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      const text = normalizeAssistantContent(msg.content);
      if (text) return text;
      return "I'm not sure how to answer that — could you rephrase?";
    }
    messages.push({
      role: "assistant",
      content: msg.content == null ? "" : msg.content,
      tool_calls: toolCalls,
    });
    for (const tc of toolCalls) {
      const toolCallId = tc.id;
      const fnName = tc.function && tc.function.name;
      let resultPayload;
      try {
        const rawArgs = (tc.function && tc.function.arguments) || "{}";
        const args = JSON.parse(rawArgs);
        const out = await dispatchJarvisTool(fnName, args);
        resultPayload = out && typeof out === "object" ? out : { ok: true };
      } catch (err) {
        console.error("Jarvis tool error:", fnName, err);
        resultPayload = { ok: false, error: err.message || String(err) };
      }
      messages.push({
        role: "tool",
        tool_call_id: toolCallId,
        content: JSON.stringify(resultPayload),
      });
    }
    response = await puterAi.chat(messages, chatOptions);
  }
  return "My apologies — that took too many steps. Please try a simpler request.";
}
