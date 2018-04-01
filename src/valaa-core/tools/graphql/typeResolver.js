import dataFieldValue from "~/valaa-core/tools/denormalized/dataFieldValue";
import { getTransientTypeName } from "~/valaa-core/tools/denormalized/Transient";

export function typeNameResolver (resource, info) {
  const typeName = getTransientTypeName(resource);
  const ret = info.schema.getType(typeName);
  if (!ret) {
    info.rootValue.logger.error(`could not resolve internal type for typeName ${
        typeName} for resource ${JSON.stringify(resource)}`);
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
        dataType} for data ${JSON.stringify(data)}`);
  }
  return ret;
}
