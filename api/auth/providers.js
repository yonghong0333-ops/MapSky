const { PROVIDERS, isConfigured } = require("../_lib/providers");

module.exports = function handler(req, res) {
  const list = Object.keys(PROVIDERS).map((id) => ({
    id,
    label: PROVIDERS[id].label,
    configured: isConfigured(id),
  }));
  res.status(200).json({ providers: list });
};
