// @flow

import type { PrefixRouter, Route } from "~/web-spindle/MapperService";
import {
  burlaesgDecode, burlaesgEncode, hs256JWTEncode,
} from "~/web-spindle/tools/security";

import { dumpObject } from "~/tools/wrapError";

export default function createProjector (router: PrefixRouter, route: Route) {
  return {
    requiredRules: [
      "routeRoot",
      "grantExpirationDelay", "tokenExpirationDelay",
      "error", "errorDescription", "errorURI",
    ],
    valueAssertedRules: [
      "clientRedirectPath", "userAgentState", "authorizationGrant", "grantProviderState",
    ],

    prepare () {
      this.runtime = router.createProjectorRuntime(this, route);
      router.setSessionAuthorizationEnabled();

      if (!this.runtime.identity) {
        throw new Error("Cannot prepare session route GET: service identity not configured");
      }
      this.runtime.scopeBase.identity = Object.freeze({
        clientSecret: this.runtime.identity.clientSecret,
        clientURI: this.runtime.identity.clientURI,
        clientCookieName: this.runtime.identity.getClientCookieName(),
        sessionCookieName: this.runtime.identity.getSessionCookieName(),
      });
    },

    preload () {
      return router.preloadRuntimeResources(this, this.runtime);
    },

    handler (request, reply) {
      router.infoEvent(1, () => [`${this.name}:`,
        "\n\trequest.params:", ...dumpObject(request.params),
        "\n\trequest.query:", ...dumpObject(request.query),
        "\n\trequest.cookies:", ...dumpObject(Object.keys(request.cookies || {})),
      ]);
      const valkOptions = router.buildRuntimeVALKOptions(this, this.runtime, request, reply);
      const scope = valkOptions.scope;
      if (router.presolveRulesToScope(this.runtime, valkOptions)) {
        router.warnEvent(1, () => [`RUNTIME RULE FAILURE ${router._routeName(this)}.`]);
        return true;
      }
      /*
      router.infoEvent(2, () => [`${this.name}:`,
        "\n\tresource:", ...dumpObject(scope.resource),
        `\n\t${scope.mappingName}:`, ...dumpObject(scope.mapping),
        `\n\ttarget:`, ...dumpObject(scope.target),
      ]);
      */
      /* eslint-disable camelcase */
      let iv, alg, payload;
      let nonce, identityChronicle, identityPartition, grantTimeStamp, email, preferred_username;
      let sessionToken, clientToken;
      const timeStamp = Math.floor(Date.now() / 1000);
      try {
        if (scope.error) {
          throw new Error(`Authorization error: ${scope.errorDescription}`);
        }
        if (!scope.userAgentState || (scope.userAgentState !== scope.grantProviderState)) {
          throw new Error("Inconsistent session authorization state");
        }

        ({ iv, alg, payload } =
            burlaesgDecode(scope.authorizationGrant, scope.identity.clientSecret));
        ({
          nonce, identityChronicle, identityPartition, timeStamp: grantTimeStamp,
          claims: { email, preferred_username },
        } = payload);
        if (!identityChronicle) identityChronicle = identityPartition;
        router.logEvent(1, () => ["Authorizing session with payload:", payload]);

        if (!(timeStamp < Number(grantTimeStamp) + scope.grantExpirationDelay)) {
          reply.code(401);
          reply.send("Authorization session request has expired");
          throw new Error("Expired");
          // return false;
        }

        sessionToken = { timeStamp, nonce, identityChronicle };
        reply.setCookie(scope.identity.sessionCookieName,
            burlaesgEncode(sessionToken, scope.identity.clientSecret, iv), {
              httpOnly: true,
              secure: true, maxAge: scope.tokenExpirationDelay, path: scope.clientRedirectPath,
            });

        clientToken = {
          iss: scope.identity.clientURI,
          sub: identityChronicle,
          iat: timeStamp,
          exp: timeStamp + scope.tokenExpirationDelay,
          email, preferred_username,
          // aud: "", nbf: "", jti: "",
        };
        reply.setCookie(scope.identity.clientCookieName,
            hs256JWTEncode(clientToken, scope.identity.clientSecret), {
              httpOnly: false,
              secure: true, maxAge: scope.tokenExpirationDelay, path: scope.clientRedirectPath,
            });
        reply.code(302);
        reply.redirect(scope.clientRedirectPath);
        return true;
      } catch (error) {
        throw router.wrapErrorEvent(error,
            new Error(`authorizeSessionWithGrant(${scope.identity.clientURI})`),
            "\n\ttimeStamp:", timeStamp,
            "\n\tauthorizationGrant:", scope.authorizationGrant,
            "\n\tclientRedirectPath:", scope.clientRedirectPath,
            "\n\tgrantExpirationDelay:", scope.grantExpirationDelay,
            "\n\ttokenExpirationDelay:", scope.tokenExpirationDelay,
            "\n\tiv:", iv,
            "\n\talg:", alg,
            "\n\tgrantTimeStamp:", grantTimeStamp,
            "\n\tnonce:", nonce,
            "\n\tidentityChronicle:", identityChronicle,
            "\n\temail:", email,
            "\n\tsessionToken:", sessionToken,
            "\n\tclientToken:", clientToken);
      }
    },
  };
}

/* eslint-enable camelcase */