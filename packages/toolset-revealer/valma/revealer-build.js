#!/usr/bin/env vlm

exports.command = "revealer-build";
exports.summary = "Build revealer bundles based on the revealer toolset config";
exports.describe = `${exports.summary}.
`;

// Example template which displays the command name itself and package name where it is ran
// Only enabled inside package
exports.disabled = (yargs) => !yargs.vlm.packageConfig;
exports.builder = (yargs) => {
  const vlm = yargs.vlm;
  return yargs.options({
    name: {
      type: "string", description: "current package name",
      default: vlm.packageConfig.name,
      interactive: { type: "input", when: "if-undefined" },
      // See https://github.com/SBoudrias/Inquirer.js/ for more interactive attributes
    },
    color: {
      type: "string", description: "message color",
      default: "reset", choices: ["reset", "red", "black"],
      interactive: { type: "list", when: "always" },
      // See https://github.com/SBoudrias/Inquirer.js/ for more interactive attributes
    },
    // See https://github.com/yargs/yargs/blob/HEAD/docs/api.md for more yargs options
  });
};

exports.handler = (yargv) => {
  const vlm = yargv.vlm;
  console.log(vlm.colors[yargv.color](`This is 'revealer-build' running inside '${yargv.name}'`));
};