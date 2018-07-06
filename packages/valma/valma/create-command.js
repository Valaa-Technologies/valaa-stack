#!/usr/bin/env vlm

exports.command = "create-command [commandName]";
exports.describe = "Create a valma command script with given name";
exports.introduction = `${exports.describe}.

By default the new command is created as a local valma.bin/ command
with the source file in valma/, making it the highest priority command
and immediately available.
Use --import to make an exported script available for local editing and
development.`;

exports.disabled = (yargs) => !yargs.vlm.packageConfig;
exports.builder = (yargs) => yargs.options({
  filename: {
    type: "string",
    description: "The new command skeleton filename in valma/ (leave empty for default)",
    interactive: { type: "input", when: "if-undefined" }
  },
  brief: {
    type: "string", description: "Description of couple words of the new command",
  },
  export: {
    type: "boolean", default: false,
    description: "Export command in package.json:bin section instead of valma.bin/ symlinking",
  },
  import: {
    type: "boolean",
    description: "Copy an existing, accessible command script as the new script",
  },
  skeleton: {
    type: "boolean",
    description: "If true will only create a minimal script skeleton",
  },
  header: {
    type: "string", description: "Lines to place at the beginning of the script skeleton",
  },
  "exports-vlm": {
    type: "string", description: "Full exports.vlm source (as Object.assign-able object)",
  },
  describe: {
    type: "string", description: "Short description of the new command set as exports.describe",
  },
  introduction: {
    type: "string", description: "Full description of the new command set as exports.introduction",
  },
  disabled: {
    type: "string", description: "Full exports.disabled source (as function callback)",
  },
  builder: {
    type: "string", description: "Full exports.builder source (as function callback)",
  },
  handler: {
    type: "string", description: "Full exports.handler source (as function callback)",
  },
});

exports.handler = async (yargv) => {
  const vlm = yargv.vlm;
  const command = yargv.commandName;
  const commandParts = command.replace(/\//g, "_").match(/^(\.)?(.*)$/);
  const commandExportName = `${commandParts[1] || ""}valma-${commandParts[2]}`;
  const scriptPath = `valma/${yargv.filename || `${commandParts[2]}.js`}`;
  let verb = "already exports";
  const import_ = yargv.import;
  let local = !yargv.export;
  while (!(vlm.packageConfig.bin || {})[commandExportName]) {
    const choices = [import_ ? "Import" : local ? "Create" : "Export", "skip",
      local ? "export instead" : "local instead"
    ];
    if (yargv.introduction) choices.push("help");
    const linkMessage = local
        ? `'valma.bin/${commandExportName}'`
        : `'package.json':bin["${commandExportName}"]`;
    const answer = await vlm.inquire([{
      message: `${import_ ? "Import" : local ? "Create" : "Export"
          } ${yargv.brief
              || (import_ ? "an existing command" : local ? "a local command" : "a command")
          } script ${import_ ? "copy" : yargv.skeleton ? "skeleton" : "template"
          } as ${linkMessage} -> '${scriptPath}'?`,
      type: "list", name: "choice", default: choices[0], choices,
    }]);
    if (answer.choice === "skip") {
      verb = "doesn't export";
      break;
    }
    if (answer.choice === "help") {
      vlm.speak(yargv.introduction);
      vlm.info(`This step creates a ${yargv.brief || (local ? "local" : "exported")
          } valma command script template\n`);
      continue;
    }
    if (answer.choice === "export instead") { local = false; continue; }
    if (answer.choice === "local instead") { local = true; continue; }
    if (!vlm.shell.test("-e", scriptPath)) {
      vlm.shell.mkdir("-p", vlm.path.dirname(scriptPath));
      if (!yargv.import) {
        vlm.shell.ShellString(_createSource(command, yargv)).to(scriptPath);
      } else {
        const resolvedPath = await vlm.invoke(command, ["-R"]);
        if ((typeof resolvedPath !== "string") || !vlm.shell.test("-f", resolvedPath)) {
          throw new Error(`Could not find command '${command}' source file for importing`);
        }
        vlm.info("Importing existing script source:", vlm.colors.path(resolvedPath));
        vlm.shell.cp(resolvedPath, scriptPath);
      }
    } else {
      vlm.warn(`Not overwriting already existing script:`, vlm.colors.path(scriptPath));
    }
    const symlinkPath = vlm.path.join("valma.bin", commandExportName);
    if (!local) {
      vlm.updatePackageConfig({ bin: { [commandExportName]: scriptPath } });
      verb = "now package.json.bin exports";
    } else if (!vlm.shell.test("-e", symlinkPath)) {
      vlm.shell.mkdir("-p", vlm.path.dirname(symlinkPath));
      vlm.shell.ln("-s", `../${scriptPath}`, symlinkPath);
      verb = "now locally valma.bin/ symlinks";
      break;
    } else {
      vlm.warn(`Cannot create local symlink at '${vlm.colors.path(symlinkPath)
          }' which already exists`);
      verb = "already symlinks";
      break;
    }
  }
  const message = `This repository ${vlm.colors.bold(verb)} valma command '${
      vlm.colors.command(command)}'.`;
  if (verb === "already exports") {
    vlm.warn(message);
    vlm.instruct("You can edit the existing command script at:",
        vlm.colors.path(vlm.packageConfig.bin[commandExportName]));
  } else {
    vlm.info(message);
    vlm.instruct(`You can edit the command ${yargv.skeleton ? "skeleton" : "template"} at:`,
        vlm.colors.path(scriptPath));
  }
  return { local, verb, [command]: scriptPath };
};

function _createSource (command, yargv) {
  // Emit shebang only if the command is a top-level command.
  const components = yargv.skeleton ? _createSkeleton() : _createExample();
  return `${(command[0] === ".") || command.includes("/.") ? "" : "#!/usr/bin/env vlm\n\n"
}${yargv.header || ""
}${!yargv.exportsVlm ? "" : `exports.vlm = ${yargv.exportsVlm};\n`
}exports.command = "${command}";
exports.describe = "${yargv.describe || yargv.brief || ""}";
exports.introduction = \`\${exports.describe}.${
    yargv.introduction ? `\n\n${yargv.introduction}` : ""}\`;

exports.disabled = ${yargv.disabled || components.disabled};
exports.builder = ${yargv.builder || components.builder};

exports.handler = ${yargv.handler || components.handler};
`;

  function _createSkeleton () {
    return {
      disabled: "(yargs) => !yargs.vlm.packageConfig",
      builder:
`(yargs) => {
  const vlm = yargs.vlm;
  return yargs;
}`,
      handler:
`(yargv) => {
  const vlm = yargv.vlm;
  return true;
}`,
    };
  }

  function _createExample () {
    return {
      disabled: "(yargs) => !yargs.vlm.packageConfig",
      builder:
`(yargs) => {
  const vlm = yargs.vlm;
  return yargs.options({
    name: {
      // See https://github.com/yargs/yargs/blob/HEAD/docs/api.md for yargs options
      type: "string", description: "current package name",
      default: vlm.packageConfig.name,
      // See https://github.com/SBoudrias/Inquirer.js/ about interactive attributes
      interactive: { type: "input", when: "if-undefined" },
    },
    color: {
      type: "string", description: "message color",
      default: "reset", choices: ["reset", "red", "black"],
      interactive: { type: "list", when: "always" },
    },
  });
}`,
      handler:
`(yargv) => {
  // Example template which displays the command name itself and package name where it is ran
  // Only enabled inside package
  const vlm = yargv.vlm;
  vlm.info(vlm.colors[yargv.color](\`This is '\${vlm.colors.command(command)}' running inside '\${
      vlm.colors.package(yargv.name)}'\`));
}`,
    };
  }
}
