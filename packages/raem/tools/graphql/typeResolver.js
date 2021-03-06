// @flow

import { getTransientTypeName } from "~/raem/state/Transient";

import dataFieldValue from "~/raem/tools/denormalized/dataFieldValue";

const dumpify = require("~/tools/dumpify").default;

export function typeNameResolver (resource, info) {
  const typeName = getTransientTypeName(resource, info.schema);
  const ret = info.schema.getType(typeName);
  if (!ret) {
    info.rootValue.logger.error(`could not resolve internal type for typeName ${
        typeName} for resource ${dumpify(resource)}`);
  }
  return ret;
}

export function dataTypeResolver (data, info) {
  // This used to be dataType, but supporting both typeName and dataType on the server side
  // was more trouble than it is worth. Should probably rename it to objectType. It is not visible
  // outside though.
  const dataType = dataFieldValue(data, "typeName");
  const ret = info.schema.getType(dataType);
  if (!ret) {
    info.rootValue.logger.error(`could not resolve internal type for dataType ${
        dataType} for data ${dumpify(data)}`);
  }
  return ret;
}
