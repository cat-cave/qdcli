function lineCountOf(sourceText) {
  const normalized = sourceText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (normalized.length === 0) return 0;
  const content = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  return content.length === 0 ? 0 : content.split("\n").length;
}

function sourceTextOf(context) {
  return context.sourceCode?.text ?? context.getSourceCode().text;
}

function createMaxLinesRule({ limit, upperLimit }) {
  return {
    meta: {
      type: "suggestion",
      docs: {
        description: `limit files to ${limit} lines`,
      },
      schema: [],
    },
    create(context) {
      return {
        Program(node) {
          const lineCount = lineCountOf(sourceTextOf(context));
          if (lineCount <= limit) return;
          if (upperLimit !== undefined && lineCount > upperLimit) return;
          context.report({
            node,
            message: `File is ${lineCount} lines long. Split it into focused modules before it exceeds ${limit} lines.`,
          });
        },
      };
    },
  };
}

const plugin = {
  meta: {
    name: "qd",
  },
  rules: {
    "max-lines-warn": createMaxLinesRule({ limit: 450, upperLimit: 500 }),
    "max-lines-error": createMaxLinesRule({ limit: 500 }),
  },
};

export default plugin;
