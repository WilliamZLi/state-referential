# Layer 3 Spike — synthetic message insertion primitive

**Question:** The Layer 3 spec (§11, open question #1) frets that inserting a
synthetic message "after message M" is hard because ST stores messages by index
and "inserting in the middle requires reindexing and event coordination." Is
that a real blocker, or already solved?

**Answer: already solved by a native ST idiom. Not a blocker.**

## What the spike covers

| Half | Where | What it proves |
|---|---|---|
| Array-level splice + stamping logic | `src/pipeline/L3Insert.js` + `tests/pipeline/L3Insert.test.js` (8 tests, `node --test`) | Correct position, stable top-level tracker id, skip-gate stamp, edge cases. |
| DOM re-render survives mid-insert | `spike/l3-insert-harness.js` (paste into ST devtools) | After a mid-array insert + `reloadCurrentChat()`, every `.mes[mesid=N]` still maps to `chat[N]`. |

Run the browser half: open a chat with ≥3 messages → F12 → paste
`l3-insert-harness.js` → read the PASS/FAIL report → `await window.__l3UndoInsert()`.

## Findings (these update/correct the Layer 3 spec)

1. **Mid-array insertion is native.** ST core's own pattern for inserting at an
   index (`public/script.js:5848`) is:
   ```js
   chat.splice(insertAt, 0, message);
   await saveChatConditional();
   await eventSource.emit(event_types.MESSAGE_RECEIVED, insertAt); // or MESSAGE_SENT
   await reloadCurrentChat();   // full re-render → reindexes every mesid
   ```
   `reloadCurrentChat()` reprints from the `chat` array, so DOM `mesid`s come out
   contiguous and correct for free. The `addOneMessage({insertAfter})` DOM-surgery
   path exists but does **not** renumber later mesids — do not use it for L3;
   prefer splice + reload, exactly like core.

2. **Tracker id placement — spec §3.3 is wrong.** The spec says synthetic
   messages get an `extra.trackerMsgId`. The implemented convention
   (`src/util/id.js`) stores the id at the **message top level**
   (`message.state_referential_msgId`) because ST swaps `msg.extra` per swipe.
   The primitive uses `ensureTrackerMsgId`. **Action: fix spec §3.3 wording.**

3. **The skip-gate already exists and covers us.** Layer 1 ignores our own
   inserts via `extra.from === 'state-referential'` (`Versioning.js:34`,
   `index.js:125`). The primitive stamps it; the harness emits `MESSAGE_RECEIVED`
   after inserting specifically to prove the gate holds in-browser.

4. **The real integration cost is `CHAT_CHANGED`, not reindexing.**
   `reloadCurrentChat()` emits `CHAT_CHANGED`, which Layer 1's
   `Versioning._onChatChanged` reacts to with a backend reload/swap. This is
   benign for L3 inserts (they don't change tracker state — fold-back applies its
   diff separately via `applyCommands`), but the plan should treat every L3 insert
   as "triggers a full Layer 1 chat-reload" and make sure that path is idempotent.

5. **Prior art exists.** `index.js:90 insertSmallSysMessage` already appends a
   small-sys message, and `StandaloneProbe` already inserts collapsed
   `from:'state-referential'` messages. Layer 3's primitive is the **mid-array**
   generalization of that helper — extend it with an `afterTrackerMsgId` option
   rather than writing a parallel path.

## Verdict

Green-light the full Layer 3 plan. The feared insertion primitive is a thin
wrapper over an established ST idiom; risk has moved off "can we even insert" and
onto the two things the plan should sequence early instead: **(a)** compaction's
*physical message removal* vs Layer 1's `_onDeleted` handler, and **(b)** the
`CHAT_CHANGED`-on-every-insert idempotency contract above.
