// Bounded worker defaults. Main model/effort is selected by the user.
// Keep one accountable parent, independent units, and a separate critical review.
// These helpers select roles; use measured accepted-task cost before changing tiers.
const scout = (prompt, options = {}) => agent(prompt, { model: 'sonnet', effort: 'low', agentType: 'Explore', ...options });
const grunt = (prompt, options = {}) => agent(prompt, { model: 'haiku', ...options });
const build = (prompt, options = {}) => agent(prompt, options);
const verify = (prompt, options = {}) => agent(prompt, { agentType: 'verify-depth', ...options });
