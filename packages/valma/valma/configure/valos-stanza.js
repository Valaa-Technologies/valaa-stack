exports.command = ".configure/.valos-stanza";
exports.describe = "Configure valos stanza type and domain from the available options";
exports.introduction = `${exports.describe}.

Type determines the localized role and structure of this workspace.
Domain defines the context and the overall purpose of this workspace.
Both affect the available toolsets for the workspace.`;

exports.disabled = (yargs) => yargs.vlm.getValOSConfig() && "Already configured";
exports.builder = (yargs) => {
  const vlm = yargs.vlm;
  const valos = vlm.packageConfig.valos || {};
  const typeChoices = vlm.listMatchingCommands(".configure/.type/{,*/**/}*")
      .map(n => n.match(/^.configure\/.type\/(@[^/@]*\/[^/@]*|[^/@]*)/)[1])
      .filter(n => n)
      .concat("<custom>");
  const domainChoices = vlm.listMatchingCommands(".configure/.domain/{,*/**/}*")
      .map(n => n.match(/^.configure\/.domain\/(@[^/@]*\/[^/@]*|[^/@]*)/)[1])
      .filter(n => n)
      .concat("<custom>");
  return yargs.options({
    reconfigure: {
      alias: "r", type: "boolean",
      description: "Reconfigure ValOS type and domain of this workspace.",
    },
    type: {
      type: "string", default: valos.type, choices: typeChoices,
      description: "Select workspace package.json stanza valos.type",
      interactive: {
        type: "list", when: vlm.reconfigure ? "always" : "if-undefined", pageSize: 10,
        confirm: _inquireIfCustomThenAlwaysConfirm.bind(null, vlm, "type"),
      },
    },
    domain: {
      type: "string", default: valos.domain, choices: domainChoices,
      description: "Select workspace package.json stanza valos.domain",
      interactive: {
        type: "list", when: vlm.reconfigure ? "always" : "if-undefined", pageSize: 10,
        confirm: _inquireIfCustomThenAlwaysConfirm.bind(null, vlm, "domain"),
      },
    },
  });
};

async function _inquireIfCustomThenAlwaysConfirm (vlm, category, selection, answers) {
  if (selection === "<custom>") {
    answers[category] = await vlm.inquireText(`Enter custom valos.${category}:`);
  }
  vlm.speak(await vlm.invoke(
      `.configure/.${category}/${answers[category]}`, ["--show-introduction"]));
  return vlm.inquireConfirm(`Confirm valos.${category} selection: '${answers[category]}'?`);
}

exports.handler = (yargv) => yargv.vlm.updatePackageConfig({
  valos: {
    type: yargv.type,
    domain: yargv.domain,
  },
});
