// @flow
import React from "react";
import VALEK from "~/valaa-engine/VALEK";
import Presentable from "~/valaa-inspire/ui/Presentable";
import UIComponent from "~/valaa-inspire/ui/UIComponent";

import TextFileEditor from "~/valaa-inspire/ui/TextFileEditor";

import { mediaTypeFromFilename } from "~/valaa-tools/MediaTypeData";

@Presentable(require("./presentation").default, "MediaEditor")
export default class MediaEditor extends UIComponent {
  preRenderFocus (focus: any) {
    const mediaType = focus.get(VALEK.to("mediaType").nullable().select(["type", "subtype"]))
        || mediaTypeFromFilename(focus.get("name"));
    if (!mediaType) return <p>Cannot determine media type for file {`'${focus.get("name")}'`}</p>;
    if (!isTextMediaType(mediaType)) {
      return (<p>
        Non-text/unrecognized media type {`${mediaType.type}/${mediaType.subtype}`}
        for file {`'${focus.get("name")}'`}
      </p>);
    }
    return (<div {...this.presentation("root")}>
      <TextFileEditor {...this.childProps("textFileEditor")} />
    </div>);
  }
}

function isTextMediaType (mediaType: Object) {
  if (mediaType.type === "text") return true;
  if ((mediaType.type === "application") && (mediaType.subtype.slice(-6) === "script")) return true;
  if ((mediaType.type === "application") && (mediaType.subtype === "xml")) return true;
  if ((mediaType.type === "application") && (mediaType.subtype === "json")) return true;
  return false;
}
