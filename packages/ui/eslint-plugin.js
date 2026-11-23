/**
 * Stash lint rules that keep the interface on tokens. Playbook: "Tokens enforced by lint".
 *
 *   stash/no-raw-color          hex, rgb(), hsl(), oklch() and named-color literals outside tokens.ts
 *   stash/no-arbitrary-values   Tailwind arbitrary values like p-[13px] or bg-[#fff]
 *   stash/spacing-scale         padding, margin, gap and offsets off the 4/8/12/16/24/32/48/64 scale
 */

const RAW_COLOR = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/;
const ARBITRARY = /(?:^|[\s"'`:])!?-?[a-z][\w-]*-\[[^\]\s]+\]/;
const ARBITRARY_PROPERTY = /(?:^|[\s"'`])\[[a-z-]+:[^\]\s]+\]/;
const SPACING =
  /(?:^|[\s"'`:])-?(p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y|inset|inset-x|inset-y|top|right|bottom|left|start|end|scroll-m|scroll-p)-(\d+(?:\.\d+)?)(?=$|[\s"'`])/g;
const ALLOWED_STEPS = new Set(["0", "1", "2", "3", "4", "6", "8", "12", "16"]);

function stringsOf(node) {
  if (node.type === "Literal" && typeof node.value === "string") return [node.value];
  if (node.type === "TemplateLiteral") return node.quasis.map((q) => q.value.cooked ?? q.value.raw);
  return [];
}

function makeRule(description, check) {
  return {
    meta: { type: "problem", docs: { description }, schema: [] },
    create(context) {
      const visit = (node) => {
        // Import specifiers and directives are not styling.
        const parent = node.parent;
        if (parent && (parent.type === "ImportDeclaration" || parent.type === "ExportNamedDeclaration" || parent.type === "ExportAllDeclaration")) return;
        if (parent && parent.type === "ExpressionStatement" && parent.directive) return;
        for (const s of stringsOf(node)) {
          const message = check(s);
          if (message) context.report({ node, message });
        }
      };
      return { Literal: visit, TemplateLiteral: visit };
    },
  };
}

const plugin = {
  meta: { name: "eslint-plugin-stash" },
  rules: {
    "no-raw-color": makeRule("Colors come only from tokens", (s) =>
      RAW_COLOR.test(s) ? "Raw color value. Use a token from @stash/ui (for example bg-surface or text-accent)." : null,
    ),
    "no-arbitrary-values": makeRule("No Tailwind arbitrary values", (s) =>
      ARBITRARY.test(s) || ARBITRARY_PROPERTY.test(s)
        ? "Arbitrary Tailwind value. Use a token or add one to packages/ui/src/tokens.ts through the lead."
        : null,
    ),
    "spacing-scale": makeRule("Spacing stays on the 4 px scale", (s) => {
      for (const m of s.matchAll(SPACING)) {
        if (!ALLOWED_STEPS.has(m[2])) {
          return `Spacing ${m[1]}-${m[2]} is off the scale. Use one of 0, 1, 2, 3, 4, 6, 8, 12, 16 (4 to 64 px).`;
        }
      }
      return null;
    }),
  },
};

export default plugin;
