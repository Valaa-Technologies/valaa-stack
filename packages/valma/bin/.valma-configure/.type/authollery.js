exports.command = ".configure/.type/authollery";
exports.summary = "Configure a Valaa authollery repository";
exports.describe = `${exports.summary}. Autholleries (ie. authority controller repositories) are ${
    ""} used to configure, deploy, update and monitor live infrastructure resources relating to ${
    ""} a particular Valaa authority.
Installs a devDependency to @valos/valma-toolset-authollery.`;

exports.builder = (yargs) => yargs;

exports.handler = async (yargv) => {
  await yargv.vlm.executeExternal("npm",
      ["install", "--save-dev", "@valos/valma-toolset-authollery"]);
  return yargv.vlm.callValma(`.configure/.type/.authollery/**/*`);
}
