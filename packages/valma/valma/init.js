#!/usr/bin/env vlm

exports.command = "init";
exports.describe = "Initialize the current directory as a Valaa repository from scratch";
exports.introduction = `${exports.describe}.

This process will walk you through creating and configuring a new
valma repository in the current working directory from scratch.

Valma init has following interactive phases:
1. Initialization of package.json via 'yarn init'
2. Configuration of repository valaa type and domain via 'vlm .configure/.valaa-stanza'
3. Addition of new known workshops via 'yarn add -W --dev'
4. Selection of in-use toolsets from available toolsets via 'vlm .configure/.select-toolsets'
5. Configuration of in-use toolsets and tools via 'vlm configure'`;

exports.disabled = (yargs) => yargs.vlm.getToolsetsConfig() && "toolsets.json exists";
exports.builder = (yargs) => yargs.options({
  reconfigure: {
    alias: "r", type: "boolean",
    description: "Reconfigure all repository configurations",
  },
});

exports.handler = async (yargv) => {
  const vlm = yargv.vlm;
  vlm.speak(exports.introduction.match(/[^\n]*\n(.*)/)[1]);
  const tellIfNoReconfigure = !yargv.reconfigure ? ["(no --reconfigure given)"] : [];

  return await _initPackageJSON()
      && await _selectValaaTypeAndDomain()
      && await _addInitialValmaDevDependencies()
      && await _configure();

  async function _initPackageJSON () {
    while (yargv.reconfigure || !vlm.packageConfig) {
      const choices = (vlm.packageConfig ? ["Skip", "reconfigure"] : ["Initialize"])
          .concat(["help", "quit"]);
      const answer = await vlm.inquire([{
        message: `${vlm.packageConfig ? "Reconfigure the existing" : "Initialize"
            } package.json with 'yarn init'?`,
        type: "list", name: "choice", default: choices[0], choices,
      }]);
      if (answer.choice === "Skip") break;
      if (answer.choice === "quit") return false;
      if (answer.choice === "help") {
        vlm.speak();
        vlm.info("repository initialization",
`This phase uses '${vlm.colors.executable("yarn init")}' to initialize package.json via a series of
interactive questions.
Valaa repositories use yarn extensively for version, dependency and
script management; ${vlm.colors.path("package.json")} is the central package configuration
file for yarn (and for npm, for which yarn is an analogue).
`);
        continue;
      }
      await vlm.execute("yarn init");
      return true;
    }
    vlm.info(`Skipped '${vlm.colors.executable("yarn init")}'.`, ...tellIfNoReconfigure);
    return true;
  }

  async function _selectValaaTypeAndDomain () {
    let justConfigured = false;
    while (yargv.reconfigure || !vlm.packageConfig.valaa || justConfigured) {
      const choices = (justConfigured ? ["Confirm", "reconfigure"]
              : vlm.packageConfig.valaa ? ["Skip", "reconfigure"] : ["Initialize"])
          .concat(["help", "quit"]);
      const answer = await vlm.inquire([{
        message: !vlm.packageConfig.valaa
            ? "Initialize repository valaa stanza type and domain?"
            : `${justConfigured ? "Confirm selection or reconfigure" : "Reconfigure"
                } valaa stanza: ${JSON.stringify({ ...vlm.packageConfig.valaa })}?`,
        type: "list", name: "choice", default: choices[0], choices,
      }]);
      if (answer.choice === "Skip") break;
      if (answer.choice === "quit") return false;
      if (answer.choice === "help") {
        vlm.speak();
        await vlm.invoke(".configure/.valaa-stanza", ["--show-describe"]);
        vlm.speak();
        continue;
      }
      if (answer.choice === "Confirm") return true;
      vlm.reconfigure = yargv.reconfigure;
      await vlm.invoke(".configure/.valaa-stanza", { reconfigure: yargv.reconfigure });
      justConfigured = true;
    }
    vlm.info("Skipped repository valaa type and domain configure.", ...tellIfNoReconfigure);
    return true;
  }

  async function _addInitialValmaDevDependencies () {
    const yarnAdd = "yarn add -W --dev";
    const coloredYarnAdd = vlm.colors.executable(yarnAdd);
    let wasError;
    const wasInitial = !vlm.packageConfig.devDependencies;
    while (yargv.reconfigure || wasInitial) {
      const choices = vlm.packageConfig.devDependencies
          ? ["Skip", "yes", "help", "quit"]
          : ["Yes", "skip", "help", "quit"];
      let answer = await vlm.inquire([{
        message: wasError
            ? "Retry adding workshops (or direct toolsets) as devDependencies?"
            : `${vlm.colors.executable("yarn add")} ${
                vlm.packageConfig.devDependencies ? "more" : "initial"
              } workshops (or direct toolsets) as devDependencies?`,
        type: "list", name: "choice", default: choices[0], choices,
      }]);
      wasError = false;
      if (answer.choice === "Skip" || answer.choice === "skip") break;
      if (answer.choice === "quit") return false;
      if (answer.choice === "help") {
        vlm.speak();
        vlm.info("workshop registration",
`This phase uses '${coloredYarnAdd}' to add workshops as devDependencies.
This makes the toolsets in those workshops to be immediately available
for the listings in following phases.
`);
        continue;
      }
      answer = await vlm.inquire([{
        type: "input", name: "devDependencies",
        message: `enter a space-separated list of workshops for '${coloredYarnAdd}':\n`,
      }]);
      if (!answer || !answer.devDependencies) {
        vlm.info(`No devDependencies provided, skipping workshop registration phase`);
      } else {
        try {
          await vlm.execute(["yarn add -W --dev", answer.devDependencies]);
        } catch (error) {
          vlm.speak();
          vlm.exception(`An exception caught during executable '${
              vlm.colors.executable(yarnAdd, answer.devDependencies)}':`, error);
          wasError = true;
        }
      }
    }
    vlm.info(`Skipped '${coloredYarnAdd}'.`, ...tellIfNoReconfigure);
    return true;
  }

  async function _configure () {
    while (yargv.reconfigure || !vlm.getToolsetsConfig()) {
      const choices = (vlm.getToolsetsConfig() ? ["Skip", "reconfigure"] : ["Initialize"])
          .concat(["help", "quit"]);
      const answer = await vlm.inquire([{
        message: `${vlm.getToolsetsConfig() ? "Reconfigure" : "Configure"} repository with '${
            vlm.colors.command("vlm configure")}'?`,
        type: "list", name: "choice", default: choices[0], choices,
      }]);
      if (answer.choice === "Skip") break;
      if (answer.choice === "quit") return false;
      if (answer.choice === "help") {
        vlm.speak();
        await vlm.invoke("configure", ["--show-describe"]);
        vlm.speak();
        continue;
      }
      return await vlm.invoke("configure", { reconfigure: yargv.reconfigure });
    }
    vlm.info("Skipped 'vlm configure'.", ...tellIfNoReconfigure);
    return true;
  }
};
