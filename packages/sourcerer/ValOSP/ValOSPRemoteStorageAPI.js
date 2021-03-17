// @flow

import type { MediaInfo } from "@valos/sourcerer";
import { debugObjectType, dumpObject, FabricEventTarget, fetchJSON, valosUUID } from "@valos/tools";

/**
 * This class is repsonsible for uploads and downloads to the valos
 * bvob storage backend. It keeps track of local uploads and can let
 * other parts of the system know when an upload is in progress for
 * a given bvob.
 */
export default class ValOSPRemoteStorageAPI extends FabricEventTarget {
  _authorityConfig: Object;

  _uploadedContentHashes: Object;

  constructor (authority, authorityConfig) {
    super(authority, undefined, authorityConfig.name);
    this._authorityConfig = authorityConfig;

    this.logEvent(1, () => [
      `Creating amplify storage provider to '${
          authorityConfig.s3.endpoint || "default"}': ${this._storageProviderName}`,
    ]);
    const customEndpoint = authorityConfig.s3.endpoint;
    if (customEndpoint) {
      this._liveBucketOptions.endpoint = this._pendingBucketOptions.endpoint = customEndpoint;
    }
    this._uploadedContentHashes = {};
    this._pendingOctetStreamDownloads = {};
  }

  downloadBvobContents (mediaInfos: MediaInfo[]): any {
    return mediaInfos.map(this._downloadContent);
  }

  _downloadContent = (mediaInfo) => {
    const asURL = mediaInfo.asURL && "URL";
    const mediaName = mediaInfo.name ? `media '${mediaInfo.name}'` : "unnamed media";
    const whileTrying = `while trying to fetch ${mediaName} ${asURL || "content"}`;
    const contentHash = mediaInfo.contentHash || mediaInfo.bvobId;
    const contentType = mediaInfo.contentType
        || mediaInfo.mime
        || ((mediaInfo.type && mediaInfo.subtype) && `${mediaInfo.type}/${mediaInfo.subtype}`);
    let options;
    try {
      if (!contentHash) {
        throw new Error(`requestMediaContent.(contentHash|bvobId) missing ${whileTrying}`);
      }
      if (asURL && !contentType) {
        throw new Error(`getMediaURL.mime (or type/subtype or contentType) missing`);
      }
      const isShareable = !asURL
          && ((contentType === undefined) || (contentType !== "application/octet-stream"));
      const pendingDownload = isShareable && this._pendingOctetStreamDownloads[contentHash];
      if (pendingDownload) return pendingDownload;
      if (pendingDownload === null) {
        this.warnEvent(1, () => [
          `RE-GET for ${mediaName} bvob content:`, contentHash, ": request has been done before",
        ]);
      }

      options = Object.assign({
        download: !mediaInfo.asURL,
        contentType,
        contentDisposition: ((mediaInfo.contentDisposition === "attachment") && mediaInfo.name)
            ? `attachment; "${mediaInfo.name}"`
            : mediaInfo.contentDisposition,
        contentEncoding: mediaInfo.contentEncoding,
        contentLanguage: mediaInfo.contentLanguage,
      }, this._liveBucketOptions);

      this.logEvent(2, () => [
        `GET ${mediaName} bvob content:`, contentHash, "and options", ...dumpObject(options),
      ]);
      const ret = this.Storage.get(contentHash, options)
          .then(awsRes => awsRes.Body)
          .catch(onError.bind(this));

      if (isShareable) {
        this._pendingOctetStreamDownloads[contentHash] = ret;
        ret.finally(() => {
          this._pendingOctetStreamDownloads[contentHash] = null;
        });
      }
     return ret;
    } catch (error) { onError.call(this, error); }
    function onError (error) {
      const wrap = this.wrapErrorEvent(error, `downloadBvobContents(${mediaName})`, whileTrying,
          "\n\terror itself:", ...dumpObject({ error }),
          "\n\tmediaInfo:", ...dumpObject(mediaInfo),
          "\n\toutgoing options:", ...dumpObject(options),
      );
      this.outputErrorEvent(error);
      throw wrap;
    }
    return undefined;
  }

  /**
   * Store a bvob in the cloud backend.
   * Locally calculates the bvob's content hash and then initiates an
   * upload. This function does not await the upload to complete, but
   * the verifyContent function can be used to wait for an upload.
   * The upload stores a promise in the pendingUploads property that
   * will resolve once the upload has completed and been verified by
   * the backend. This promise can be awaited by clientside code that
   * need to wait for the upload to be completed.
   * The promise is stored against the mediaInfo.bvobId.
   * @param {string} content The bvob content
   */
  uploadBvobContent (
      content: ?ArrayBuffer | () => Promise<ArrayBuffer>,
      mediaInfo,
  ): ?string | Promise<?string> {
    const contentHash = mediaInfo.contentHash || mediaInfo.bvobId;
    const mediaName = mediaInfo.name ? `media '${mediaInfo.name}'` : "unnamed media";
    try {
      const alreadyUploadedPromiseToHash = this._uploadedContentHashes[contentHash];
      if (alreadyUploadedPromiseToHash) return alreadyUploadedPromiseToHash;
      if (!content) return contentHash;
      return (this._uploadedContentHashes[contentHash] = new Promise(async (resolve, reject) => {
        try {
          const uploadId = valosUUID();
          let buffer = (typeof content === "function") ? await content() : content;
          if (ArrayBuffer.isView(buffer)) buffer = buffer.buffer;
          else if (!(buffer instanceof ArrayBuffer)) {
            throw new Error(`Invalid bvob content type; expected ArrayBuffer, instead got: ${
                debugObjectType(buffer)}`);
          }
          this.logEvent(2, () => [
            `PUT ${mediaName} bvob content with hash:`, contentHash,
          ]);
          await this.Storage.put(uploadId, buffer, this._pendingBucketOptions);
          const verification = await fetchJSON(
              `${this._authorityConfig.rest.verifyEndpoint}?pendingObjectName=${uploadId}`);
          const verifiedContentHash = verification.contentHash || verification.contentId;
          if (verifiedContentHash !== contentHash) {
            this._uploadedContentHashes[verifiedContentHash] = verifiedContentHash;
            throw new Error(`ContentId mismatch for upload ${uploadId} (of ${mediaName
                }): server calulated ${verifiedContentHash} but client expected ${contentHash}`);
          }
          this._uploadedContentHashes[contentHash] = contentHash;
          resolve(verifiedContentHash);
        } catch (error) {
          delete this._uploadedContentHashes[contentHash];
          reject(onError.call(this, error));
        }
      }));
    } catch (error) { throw onError.call(this, error); }
    function onError (error) {
      return this.wrapErrorEvent(error, `uploadBvobContent(${contentHash}, ${mediaName})`,
          "\n\tcontentHash:", contentHash,
      );
    }
  }
}
