exports.vlm = { toolset: "@valos/toolset-revealer" };
exports.command = ".configure/.toolset/@valos/toolset-revealer";
exports.describe = "Configure this repository for webpack revelation bundling with toolset-revealer";
exports.introduction = `${exports.describe}.

Adds valma command 'rouse-revealer'.

Sets up the webpack entry and output config as webpack.config.js in
the repository root, which combines shared revealer config from
@valos/toolset-revealer/shared/webpack.config.js, local toolset config
and any customizations in the root webpack.config.js itself.`;

// Example template which displays the command name itself and package name where it is ran
// Only enabled inside package
exports.disabled = (yargs) => !yargs.vlm.getToolsetConfig(yargs.vlm.toolset, "inUse");
exports.builder = (yargs) => yargs.options({
  reconfigure: {
    alias: "r", type: "boolean",
    description: "Reconfigure all toolset-revealer configurations",
  },
});

exports.handler = (yargv) => {
  const vlm = yargv.vlm;
  const toolsetWebpackConfig = vlm.getToolsetConfig(vlm.toolset, "webpack");
  const templates = vlm.path.join(__dirname, "../templates/{.,}*");
  vlm.info("Copying revealer template files from ", templates, "(will not clobber existing files)");
  vlm.shell.cp("-n", templates, ".");
  vlm.instruct("! Edit webpack.config.js to configure webpack entry and output locations.");
  if (!toolsetWebpackConfig) {
    vlm.updateToolsetConfig(vlm.toolset, {
      webpack: {
        entry: { "valaa-inspire": "./node_modules/@valos/inspire/index.js" },
        output: {
          path: "dist/revealer/valaa/inspire/",
          publicPath: "/valaa/inspire/",
          filename: "[name].js"
        }
      }
    });
    vlm.instruct(`! Edit toolsets.json:["${vlm.toolset
        }"].webpack to further configure webpack entry and output locations.`);
  }
  return true;
};
