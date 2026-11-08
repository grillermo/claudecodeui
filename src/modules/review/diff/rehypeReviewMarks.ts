import { DEL_CLOSE, DEL_OPEN, INS_CLOSE, INS_OPEN } from '@/modules/review/diff/documentDiff';

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};
type Mode = 'ins' | 'del' | null;

const SPLIT = /([\ue000-\ue003])/;
const CLASS_NAMES: Record<'ins' | 'del', string[]> = {
  ins: ['rounded-sm', 'bg-emerald-500/20', 'no-underline'],
  del: ['rounded-sm', 'bg-red-500/20', 'line-through', 'opacity-70'],
};

const wrap = (mode: 'ins' | 'del', child: HastNode): HastNode => ({
  type: 'element',
  tagName: mode,
  properties: { className: CLASS_NAMES[mode] },
  children: [child],
});

function nextMode(mode: Mode, sentinel: string): Mode {
  if (sentinel === INS_OPEN) return 'ins';
  if (sentinel === DEL_OPEN) return 'del';
  if (sentinel === INS_CLOSE || sentinel === DEL_CLOSE) return null;
  return mode;
}

/** Rebuilds `<ins>`/`<del>` from the sentinels documentDiff put in the source. */
export function rehypeReviewMarks() {
  return (tree: HastNode) => {
    let mode: Mode = null;

    const walk = (parent: HastNode) => {
      const output: HastNode[] = [];
      for (const child of parent.children ?? []) {
        if (child.type === 'element' && child.tagName === 'code') {
          // CodeBlock expects one string child, so inline code is wrapped whole.
          let wrapMode: Mode = mode;
          const value = (child.children ?? []).map((node) => node.value ?? '').join('');
          const clean = value.split(SPLIT).map((piece) => {
            if (SPLIT.test(piece)) {
              mode = nextMode(mode, piece);
              wrapMode = wrapMode ?? mode;
              return '';
            }
            return piece;
          }).join('');
          const code = { ...child, children: [{ type: 'text', value: clean }] };
          output.push(wrapMode ? wrap(wrapMode, code) : code);
          continue;
        }
        if (child.type === 'text' && typeof child.value === 'string') {
          for (const piece of child.value.split(SPLIT)) {
            if (SPLIT.test(piece)) {
              mode = nextMode(mode, piece);
            } else if (piece) {
              const text = { type: 'text', value: piece };
              output.push(mode ? wrap(mode, text) : text);
            }
          }
          continue;
        }
        if (child.children) {
          walk(child);
        }
        output.push(child);
      }
      parent.children = output;
    };

    walk(tree);
  };
}
