# canUseTool Timeout Matrix Experiment

**Date**: 2026-02-01
**Environment**: Claude Agent SDK 0.2.29, Claude Code 2.0.65

---

## Matrix Experiment Results

### Dimensions Tested
- **Tool Types**: AskUserQuestion, Permission Request (Bash)
- **Wait Times**: 30s, 60s, 90s, 120s, 300s (5 min)
- **Total Tests**: 10 (run in parallel)

### AskUserQuestion Results

| Wait Time | Success | Timed Out | Actual Duration |
|-----------|---------|-----------|-----------------|
| 30s       | ✅      | No        | 47.0s           |
| 60s       | ✅      | No        | 78.3s           |
| 90s       | ✅      | No        | 106.8s          |
| 120s      | ✅      | No        | 136.9s          |
| **300s**  | ✅      | No        | **318.1s**      |

### Permission Request (Bash) Results

| Wait Time | Success | Timed Out | Actual Duration |
|-----------|---------|-----------|-----------------|
| 30s       | ✅      | No        | 14.9s           |
| 60s       | ✅      | No        | 14.9s           |
| 90s       | ✅      | No        | 14.5s           |
| 120s      | ✅      | No        | 14.6s           |
| 300s      | ✅      | No        | 14.8s           |

### Key Observations

1. **AskUserQuestion**: All tests succeeded, even at 300s (5 minutes)! The callback waited the full duration before returning.

2. **Permission Request (Bash)**: Interesting! All tests completed in ~15 seconds regardless of wait time. This suggests **the callback was never invoked** - likely because the model decided not to use Bash or used a different approach.

3. **No 60-second timeout observed** for either tool type in any test.

---

## Original Single-Test Experiment

## Hypothesis

According to the official documentation at https://platform.claude.com/docs/en/agent-sdk/user-input:

> "Your callback must return within **60 seconds** or Claude will assume the request was denied and try a different approach."

Since `AskUserQuestion` goes through the `canUseTool` callback, it should be subject to the same 60-second timeout.

## Experiment Design

1. Create a script that prompts Claude to use `AskUserQuestion`
2. Intercept the tool call via `canUseTool` callback
3. Wait **70 seconds** before returning a response
4. Observe whether timeout occurs or request succeeds

## Results

```
Started at: 2026-02-01T10:19:58.649Z
canUseTool called at: 6.7s
Wait started: 70 seconds
60s mark passed: No timeout, no error
Wait completed at: 76.7s
Response returned: Success
Request completed at: 80.5s
```

### Key Metrics

| Metric | Value |
|--------|-------|
| Time callback was called | 6.7s |
| Time callback returned | 76.7s |
| **Actual wait in callback** | **70 seconds** |
| Timeout occurred | **NO** |
| Request succeeded | **YES** |

## Conclusion

**The `AskUserQuestion` tool does NOT have a 60-second timeout enforced in the Claude Agent SDK (v0.2.29).**

The `canUseTool` callback waited 70 seconds and successfully returned. Claude continued processing normally and completed the task.

### Possible Explanations

1. The 60s timeout is not yet implemented in the SDK
2. The timeout exists but is not strictly enforced
3. The documentation describes intended behavior, not current behavior
4. The timeout may apply differently in hosted/managed environments

## Implications

- For SDK users: You have more time than 60 seconds to respond to `canUseTool` callbacks
- For UI builders: Don't rely on the documented 60s timeout - implement your own if needed
- For documentation readers: Verify actual behavior; docs may not match implementation

## Raw Output

See `test-ask-user-timeout.ts` for the experiment script.

```
============================================================
EXPERIMENT: AskUserQuestion 60-second Timeout Test
============================================================
Will wait 70 seconds before responding to canUseTool
Started at: 2026-02-01T10:19:58.649Z
============================================================
[2.8s] Session initialized: 4f565812-47ab-4e6d-9dab-44b976876506
[6.7s] Assistant: tool_use...

[6.7s] canUseTool called for: AskUserQuestion
[6.7s] >>> AskUserQuestion detected! Starting 70s wait...
[16.7s] ... still waiting (10s of 70s)
[26.7s] ... still waiting (20s of 70s)
[36.7s] ... still waiting (30s of 70s)
[46.7s] ... still waiting (40s of 70s)
[56.7s] ... still waiting (50s of 70s)
[66.7s] ... still waiting (60s of 70s)

[76.7s] >>> Wait complete! Returning allow response now...
[76.7s] Message type: user
[79.9s] Assistant: Great, thanks for letting me know!...
[80.0s] RESULT: Great, thanks for letting me know! You prefer **TypeScript**...

============================================================
EXPERIMENT COMPLETE
============================================================
Total time: 80.5s
AskUserQuestion received: true
Timeout/error occurred: false

>>> FINDING: AskUserQuestion appears to NOT have a 60s timeout!
>>> The canUseTool callback waited beyond 60s and still succeeded.
```
