exports.command = ".configure/.toolsets";
exports.summary = "Select and/or stow in-use toolsets from the set of known toolsets";
exports.describe = `${exports.summary}.

The set of known toolsets is defined by the set of all valma 'toolset
configure' commands listed by the invokation (note the empty selector):

vlm -da '.configure/{,.type/.<type>/,.domain/.<domain>/}.toolset/**/*'

An invokation 'vlm configure' will invoke these toolset configure
command for all toolsets that are selected to be in use.

Toolsets are usually sourced via depending on workshop packages.
Toolsets from file and global pools can be used but should be avoided
as such toolsets are not guaranteed to be always available.`;

exports.builder = (yargs) => {
  const valaa = yargs.vlm.packageConfig.valaa;
  if (!valaa || !valaa.type || !valaa.domain) return undefined;
  const valmaConfig = yargs.vlm.valmaConfig;
  if (!valmaConfig) {
    throw new Error(".valma-configure/.toolsets: current directory is not a valma repository; "
        + "valma.json missing (maybe run 'vlm init'?)");
  }
  const availableScripts = yargs.vlm.listMatchingCommands(
          `.configure/{,.type/.${valaa.type}/,.domain/.${valaa.domain}/}.toolset/**/*`);
  const availableToolsets = availableScripts.map(n => n.match(/\/.toolset\/(.*)$/)[1]);
  const toolsetsInUse = Object.keys(valmaConfig.toolset || {})
      .filter(k => valmaConfig.toolset[k]);
  return yargs.options({
    toolsets: {
      type: "string", default: toolsetsInUse,
      choices: availableToolsets.concat(
          toolsetsInUse.filter(toolset => !availableToolsets.includes(toolset))),
      interactive: { type: "checkbox", when: "always" },
      description: "Toolsets currently in use (check to select, uncheck to stow)",
    },
  });
};

exports.handler = (yargv) => {
  const valmaConfig = yargv.vlm.valmaConfig;
  if (!valmaConfig) return;

  const activeToolsets = valmaConfig.toolset || {};
  const toolset = {};

  const stowToolsets = Object.keys(activeToolsets).filter(n => !yargv.toolsets.includes(n));
  // TODO: add confirmation for configurations that are about to be eliminated with null
  stowToolsets.forEach(n => { toolset[n] = null; });
  const useToolsets = yargv.toolsets.filter(n => !activeToolsets[n]);
  useToolsets.forEach(n => { toolset[n] = {}; });

  yargv.vlm.updateValmaConfig({ toolset });
};