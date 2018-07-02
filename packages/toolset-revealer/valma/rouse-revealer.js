#!/usr/bin/env vlm

exports.vlm = { toolset: "@valos/toolset-revealer" };
exports.command = "rouse-revealer";
exports.describe = "Launch a webpack-dev-server at localhost serving a local revelation";
exports.introduction = `${exports.describe}.

The revelation consists of two parts: webpack output and static files.
Webpack output is configured by the project root webpack.config.js and
the static files are served from --content-base. If this --content-base
doesn't exist it is created by copying all files from the directory(s)
provided by --content-source.`;

exports.builder = function builder (yargs) {
  return yargs.option({
    "content-base": {
      type: "string", default: "dist/revealer",
      description: "The revelations serve directory as --content-base for webpack-dev-server",
    },
    "content-source": {
      type: "string", array: true, default: ["./revelations"],
      description: "The revelations source directory for populating an empty content-base",
    },
    host: {
      type: "string", default: "0.0.0.0",
      description: "The local ip where the server will be bound"
    },
    inline: {
      type: "boolean", default: true,
      description: "webpack-dev-server --inline option"
    },
    progress: {
      type: "boolean", default: true,
      description: "webpack-dev-server --progress option"
    },
    open: {
      type: "boolean", default: true,
      description: "webpack-dev-server --open option"
    },
  });
};
exports.handler = function handler (yargv) {
  const vlm = yargv.vlm;
  const contentBase = yargv.contentBase;
  if (!vlm.shell.test("-d", contentBase)) {
    vlm.info("Creating and populating an initially missing content base directory",
        contentBase, `(for this first time only) from ${String(yargv.contentSource)}`);
    vlm.shell.mkdir("-p", contentBase);
    (yargv.contentSource || []).forEach(source =>
        vlm.shell.cp("-R", vlm.path.join(source, "*"), contentBase));
  }
  vlm.info(`${vlm.colors.bold("Rousing revealer")} using ${
      vlm.colors.executable("webpack-dev-server")} with revelation content base:`, contentBase);
  return vlm.execute("webpack-dev-server", [
    yargv.inline && "--inline",
    yargv.progress && "--progress",
    yargv.open && "--open",
    "--host", yargv.host,
    "--content-base", contentBase,
  ]);
};
