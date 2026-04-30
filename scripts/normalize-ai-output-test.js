import assert from "node:assert/strict";
import { normalizeAIOutput } from "../apps/api/src/utils/normalizeAIOutput.js";

assert.equal(
  normalizeAIOutput("** Başlık **"),
  "** Başlık **",
  "Markdown bold text must not be treated as a bullet list"
);

assert.deepEqual(
  normalizeAIOutput("* first\n* second"),
  ["first", "second"],
  "Asterisk bullet lists should still normalize to arrays"
);

assert.deepEqual(
  normalizeAIOutput("1. first\n2. second"),
  ["first", "second"],
  "Numbered lists should still normalize to arrays"
);

console.log("normalize-ai-output-test passed");
