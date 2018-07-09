exports.command = ".";
exports.describe = "Access valma runtime context object 'vlm'";
exports.introduction = `${exports.describe}.

This command serves as a bridge to the 'vlm' context singleton and all
of its API's, most notably the 'shell' API.
`;

exports.builder = (yargs) => yargs;

exports.handler = async (yargv) => {
  // Example template which displays the command name itself and package name where it is ran
  // Only enabled inside package
  const vlm = yargv.vlm;
  const topArgs = [".", ...yargv._.slice(0, (yargv._.indexOf("--") + 1) || undefined)];
  const ret_ = (await _walk(vlm, topArgs)).value;
  // console.log("args:", topArgs, "\n\tret:", ret);
  return ret_;

  async function _walk (head, argv, index = 0, isArgument) {
    vlm.ifVerbose(1)
        .log("walk", isArgument, argv.slice(index));
    let ret;
    try {
      if (index >= argv.length) return (ret = { value: head });
      switch (argv[index]) {
        case ".": {
          const property = argv[index + 1];
          if (typeof property !== "string" && typeof property !== "number") {
            throw new Error(`expected an identifier or index after '.', got ${typeof property}`);
          }
          if (typeof head[property] !== "function") {
            return (ret = await _walk(head[property], argv, index + 2));
          }
          const args = await _getArgs(argv, index + 2);
          const nextHead = await head[property](...args.value);
          return (ret = await _walk(nextHead, argv, args.index));
        }
        case "&&":
        case "||":
          if (argv[index] === "&&" ? !head : head) return (ret = { value: head, index: undefined });
          return (ret = await _walk(vlm, argv, index + 1));
        case "(": {
          let depth = 1;
          let i = index + 1;
          for (; (i < argv.length) && depth; ++i) {
            if (argv[i] === "(") ++depth;
            if (argv[i] === ")") --depth;
          }
          if (depth) throw new Error("unmatched '('");
          const result = await _walk(vlm, argv.slice(index + 1, i - 1));
          return (ret = await _walk(result.value, argv, i));
        }
        case ")": throw new Error("mismatching ')'");
        default: {
          if (isArgument) {
            const arg = argv[index];
            const value = !(arg[0] === "{" || arg[0] === "[") ? arg : JSON.parse(arg);
            return { value, index: index + 1 };
          }
          const args = await _getArgs(argv, index + 1);
          const result = await vlm.execute([argv[index], ...args.value]);
          return (ret = await _walk(result, argv, args.index));
        }
      }
    } finally {
      vlm.ifVerbose(1)
          .log("  ret:", argv.slice(index), ret && ret.index, ":", ret && ret.value);
    }
  }

  async function _getArgs (argv, index) {
    const value = [];
    let i = index;
    const argTerminators = { ".": true, "&&": true, "||": true, ")": true };
    while (i < argv.length && !argTerminators[argv[i]]) {
      const result = (await _walk(vlm, argv, i, true));
      i = result.index;
      value.push(result.value);
    }
    return { value, index: i };
  }
};
