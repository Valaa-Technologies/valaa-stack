exports.command = ".configure/.type/gateway-plugin";
exports.describe = "Initialize gateway-plugin workspace";
exports.introduction =
`A gateway-plugin extends inspire and perspire gateways with various
types of functionalities: new resources schemas, media decoders,
protocol schemes, external APIs, valosheath APIs, etc.`;

exports.disabled = (yargs) => (yargs.vlm.getValOSConfig("type") !== "gateway-plugin")
    && `Workspace is not a 'gateway-plugin' (is '${yargs.vlm.getValOSConfig("type")}')`;
exports.builder = (yargs) => yargs.options({
  reconfigure: {
    alias: "r", type: "boolean",
    description: "Reconfigure all 'gateway-plugin' configurations of this workspace.",
  },
});

exports.handler = () => ({
  devDependencies: { "@valos/type-gateway-plugin": true },
  toolsetsUpdate: { "@valos/type-gateway-plugin": { inUse: "always" } },
  success: true,
});
