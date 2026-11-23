/**
 * Stash lint rules that keep the interface on tokens. Playbook: "Tokens enforced by lint".
 *
 *   stash/no-raw-color          hex, rgb(), hsl(), oklch() and similar color literals outside tokens.ts.
 *                               Named colors (red, white) need no rule: theme.css resets Tailwind's
 *                               palette, so bg-red-500 generates nothing.
 *   stash/no-arbitrary-values   Tailwind arbitrary values like p-[13px], bg-[#fff] and the p-(--x) shorthand
 *   stash/spacing-scale         padding, margin, gap, offsets and translations off the 4/8/12/16/24/32/48/64
 *                               scale, including p-px and the important modifier (!p-5, p-5!)
 *   stash/motion-scale          transition durations other than the motion tokens (80, 120, 160, 200 ms)
 *   stash/no-inline-style       style={...} on elements, except CSS variables (style={{ "--progress": x }})
 *
 * Widths, heights and sizes (w-, h-, size-) are not limited to the spacing scale: components have
 * fixed sizes from the design spec (rows, controls, rails) that sit between steps (decision 0009).
 */

const RAW_COLOR = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/;
const ARBITRARY = /(?:^|[\s"'`:])!?-?[a-z][\w-]*-(?:\[[^\]\s]+\]|\([^)\s]+\))/;
const ARBITRARY_PROPERTY = /(?:^|[\s"'`])\[[a-z-]+:[^\]\s]+\]/;
const SPACING =
  /(?:^|[\s"'`:])!?-?(p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y|inset|inset-x|inset-y|top|right|bottom|left|start|end|scroll-m|scroll-p|scroll-mx|scroll-my|scroll-px|scroll-py|translate-x|translate-y)-(\d+(?:\.\d+)?|px)!?(?=$|[\s"'`])/g;
const DURATION = /(?:^|[\s"'`:])!?(?:duration|delay)-(\d+)!?(?=$|[\s"'`])/g;
const ALLOWED_DURATIONS = new Set(["0", "80", "120", "160", "200"]);
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
    "motion-scale": makeRule("Durations come from the motion tokens", (s) => {
      for (const m of s.matchAll(DURATION)) {
        if (!ALLOWED_DURATIONS.has(m[1])) return `Duration ${m[1]} ms is not a motion token. Use 80, 120, 160 or 200, or duration-control.`;
      }
      return null;
    }),
    "no-inline-style": {
      meta: { type: "problem", docs: { description: "No inline style objects" }, schema: [] },
      create(context) {
        return {
          // Allowed: style={{ "--progress": x }}, which hands a computed number (a playhead position)
          // to classes that read the variable. Anything else is a style the tokens cannot see.
          JSXAttribute(node) {
            if (!node.name || node.name.name !== "style") return;
            const expr = node.value && node.value.type === "JSXExpressionContainer" ? node.value.expression : null;
            const onlyVars =
              expr &&
              expr.type === "ObjectExpression" &&
              expr.properties.every(
                (p) => p.type === "Property" && !p.computed && p.key.type === "Literal" && typeof p.key.value === "string" && p.key.value.startsWith("--"),
              );
            if (!onlyVars) {
              context.report({ node, message: "Inline style. Use token classes; pass a computed number as a CSS variable, style={{ \"--progress\": x }}." });
            }
          },
        };
      },
    },
  },
};

export default plugin;
