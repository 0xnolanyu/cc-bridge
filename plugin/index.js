// @local/dsh-cc-bridge — config-only DSH bundle.
// This package carries no runtime code of its own: it wires the cc-msg-bridge
// CLI (declared in `dependencies`) into DSH via cordis.patch.yml (dsh.bundle.patch).
// Entry point is a stub so npm/GitHub installs resolve cleanly.
export default {};
