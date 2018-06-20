#!/usr/bin/env vlm

exports.command = "configure [toolsetGlob]";
exports.summary = "Configure the current valaa repository and its toolsets";
exports.describe = `${exports.summary}.

Invokes all the in-use toolset configure commands.`;

exports.disabled = (yargs) => !((yargs.vlm || {}).packageConfig || {}).valaa;
exports.builder = (yargs) => yargs.options({
  reconfigure: {
    type: "boolean", default: false, global: true,
    description: "If not set configure will skip all already configured toolsets.",
  }
});

exports.handler = async (yargv) => {
  const vlm = yargv.vlm;
  vlm.reconfigure = yargv.reconfigure;
  if (!vlm.packageConfig) {
    throw new Error("valma-configure: current directory is not a repository; "
        + "package.json does not exist");
  }
  const valaa = vlm.packageConfig.valaa;
  if (!valaa || !valaa.type || !valaa.domain) {
    throw new Error("valma-configure: current directory is not a valaa repository; "
        + "package.json doesn't have the valaa section or it doesn't have valaa.type/domain set"
        + "(maybe run 'vlm init' to initialize?)");
  }
  if (!vlm.valmaConfig) {
    vlm.updateValmaConfig({});
  }
  vlm.askToCreateValmaScriptSkeleton = askToCreateValmaScriptSkeleton;
  vlm.confirmToolsetExists = confirmToolsetExists;
  vlm.tryGetToolsetConfig = tryGetToolsetConfig;
  vlm.tryGetToolsetToolConfig = tryGetToolsetToolConfig;

  if (!yargv.toolsetGlob) {
    await vlm.invoke(`.configure/.domain/${vlm.packageConfig.valaa.domain}`);
    await vlm.invoke(`.configure/.type/${vlm.packageConfig.valaa.type}`);
    await vlm.invoke(`.configure/.toolsets`, yargv._.slice(1));
  }
  return await vlm.invoke(`.configure/{,.type/.${valaa.type}/,.domain/.${valaa.domain}/}.toolset/${
      yargv.toolsetGlob || ""}{*/**/,}*`);
};

function confirmToolsetExists (toolsetName, toolName) {
  if (((this.valmaConfig || {}).toolset || {})[value]) return true;
  this.tailor({ toolName }).warn(
      `cannot find toolset '${toolsetName}' from active toolsets:`,
      Object.keys((this.valmaConfig || {}).toolset || {}).join(", "));
  return false;
}

function tryGetToolsetConfig (toolsetName) {
  return ((vlm.valmaConfig || {}).toolset || {})[toolsetName];
}

function tryGetToolsetToolConfig (toolsetName, toolName) {
  return ((this.locateToolsetConfig(toolsetName) || {}).tool || {})[toolName];
}

async function askToCreateValmaScriptSkeleton (script, scriptFile, {
  brief = "",
  header = "",
  summary = "",
  describe = "",
  disabled = undefined,
  builder = "(yargs) => yargs;",
  handler = `(yargv) => {\n  const vlm = yargv.vlm;\n};\n`,
  footer = "",
}) {
  const underscoredScript = script.replace(/\//g, "_");
  const command = script.replace("valma-", "");
  const scriptPath = `valma/${scriptFile}`;
  let verb = "already exports";
  while (!(this.packageConfig.bin || {})[underscoredScript]) {
    const choices = ["Create", "skip"];
    if (describe) choices.push("help");
    const answer = await this.inquire([{
      message: `Create a ${brief} command template? (package.json:.bin["${
          underscoredScript}"] -> "${scriptPath}")`,
      type: "list", name: "choice", default: choices[0], choices,
    }]);
    if (answer.choice === "skip") {
      verb = "still doesn't export";
      break;
    }
    if (answer.choice === "help") {
      console.log(this.colors.bold("This configure step creates a", brief,
          "command template with following description:"));
      console.log(describe);
      continue;
    }
    this.shell.mkdir("-p", "bin");
    this.shell.ShellString(
`${header}exports.command = "${command}";
exports.summary = "${summary}";
exports.describe = \`\${exports.summary}.${describe ? `\n\n${describe}` : ""}\`;

${expandSection("disabled", disabled)}${expandSection("builder", builder)}
${expandSection("handler", handler)}${footer}`).to(scriptPath);
  this.updatePackageConfig({ bin: { [underscoredScript]: scriptPath } });
    verb = "now exports";
  }
  if (this.verbosity >= 1) {
    console.log(`valma-configure inform: repository ${verb} valma command ${command}`);
  }
  function expandSection(sectionName, template) {
    return template === undefined ? "" : `exports.${sectionName} = ${template}\n`;
  }
}
