#!/usr/bin/env vlm

// 'build' first so tab-completion is instant. Everything else 'release' first so build and
// deploy commands get listed next to each other.
exports.command = "build-release";
exports.describe = "Build all toolset sub-releases which have source modifications";
exports.introduction = `${exports.describe}.

These sub-releases are placed under the provided dist target. This
command is first part of the two-part deployment with deploy-release
making the actual deployment.`;

exports.builder = (yargs) => yargs.options({
  target: {
    type: "string", default: "dist/release",
    description: "target directory root for building the release"
  },
  source: {
    type: "string", default: "packages",
    description: "relative lerna packages source directory for sourcing the packages"
  },
});

exports.handler = async (yargv) => {
  const vlm = yargv.vlm;
  const packageConfig = vlm.packageConfig;
  const releasePath = yargv.target;

  if (vlm.shell.test("-d", releasePath)) {
    if (packageConfig.version.indexOf("-prerelease") !== -1) {
      vlm.warn("removing an existing '-prerelease' build target:", releasePath);
      vlm.shell.rm("-rf", releasePath);
    } else {
      throw new Error(`build-release: existing build for non-prerelease version ${
        packageConfig.version} found at ${releasePath}. Bump the version number?`);
    }
  }

  vlm.shell.mkdir("-p", releasePath);

  vlm.info("building version", packageConfig.version, "of",
      packageConfig.name, "into", releasePath);

  Object.assign(vlm, {
    releasePath,
    prepareToolsetBuild,
    prepareToolBuild,
  });
  return await vlm.invoke(".release-build/**/*", [releasePath]);
};

/**
 * Validates toolset build pre-conditions and returns the toolset target dist path where the
 * actual build will be placed.
 *
 * @param {*} toolsetName
 * @param {*} releasePath
 * @returns
 */
function prepareToolsetBuild (toolsetName, toolsetDescription = "toolset",
    desiredVersionHash) {
  const logger = this.tailor({ contextCommand: `build-release/${toolsetName}` });
  const releasePath = this.releasePath;
  if (!this.shell.test("-d", releasePath)) {
    throw new Error(`${this.contextCommand}: releasePath directory '${releasePath}' missing`);
  }
  const toolsetConfig = this.getToolsetConfig(toolsetName);
  if (!toolsetConfig) return {};
  if (desiredVersionHash && (toolsetConfig.deployedVersionHash === desiredVersionHash)) {
    logger.info(`${this.colors.bold(`Skipping the ${toolsetDescription} release build`)
        } of already deployed version:`, desiredVersionHash);
    return {};
  }
  const simpleToolsetName = toolsetName.replace(/\//g, "_");
  const toolsetReleasePath = this.path.join(releasePath, simpleToolsetName);
  logger.info(`Building ${toolsetDescription} release in`, toolsetReleasePath);
  this.shell.rm("-rf", toolsetReleasePath);
  this.shell.mkdir("-p", toolsetReleasePath);
  this.toolset = toolsetName;
  return { toolsetConfig, toolsetReleasePath };
}

function prepareToolBuild (toolsetName, toolName,
    toolDescription = "tool", desiredVersionHash) {
  const logger = this.tailor({ contextCommand: `build-release/${toolName}` });
  const toolConfig = this.getToolConfig(toolsetName, toolName);
  if (!toolConfig) return {};
  if (desiredVersionHash && (toolConfig.deployedVersionHash === desiredVersionHash)) {
    logger.info(`${this.colors.bold(`Skipping the ${toolDescription} release build`)
        } of already deployed version within toolset ${toolsetName}:`, desiredVersionHash);
    return {};
  }
  const simpleToolsetName = toolsetName.replace(/\//g, "_");
  const simpleToolName = toolName.replace(/\//g, "_");
  const toolReleasePath = this.path.join(this.releasePath, simpleToolsetName, simpleToolName);
  logger.info(`building ${toolDescription} release in '${toolReleasePath}'`);
  this.shell.rm("-rf", toolReleasePath);
  this.shell.mkdir("-p", toolReleasePath);
  return { toolConfig, toolReleasePath };
}