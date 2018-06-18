const shared = require("@valos/toolset-revealer/shared/webpack.config.js");
const path = require("path");

const valmaConfigRevealerSection = require(`${process.cwd()}/valma.json`)
    .toolset["@valos/toolset-revealer"].webpack;
valmaConfigRevealerSection.output.path = path.posix.resolve(valmaConfigRevealerSection.output.path);

module.exports = {
  ...shared,
  ...valmaConfigRevealerSection,
  devServer: {
    ...shared.devServer,
    publicPath: `/valaa/inspire/`,
  },
  module: {
    ...shared.module,
    rules: [
      { use: { loader: "babel-loader" }, test: /\.js$/, exclude: /node_modules/, },
      ...shared.module.rules.map(rule => (
          rule.use && (rule.use[0] === "style-loader")
              ? { ...rule, include: "/packages/" }
          : rule
      ))
    ],
  },
};
