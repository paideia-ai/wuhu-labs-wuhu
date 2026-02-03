import { assert } from "@std/assert";
import { isAbsolute, join } from "@std/path";

export interface ResolverPackageConfig {
  name?: string;
  path: string;
  imports: Record<string, string>;
  exports: Record<string, string>;
}

export interface ResolverWorkspaceConfig {
  rootPath: string;
  packages: ResolverPackageConfig[];
  jsrVersions: Record<string, string>;
}

export type ResolveResult = {
  type: "local";
  path: string;
} | {
  type: "peer";
  packageName: string;
  path: string;
} | {
  type: "npm";
  specifier: string;
} | {
  type: "jsr";
  packageName: string;
  version: string;
  path: string;
};

const jsrPackageCache = new Map<string, Record<string, string>>();

export async function resolve(
  config: ResolverWorkspaceConfig,
  specifier: string,
  importerPath: string,
): Promise<ResolveResult> {
  assert(
    !specifier.startsWith("."),
    "relative import must be handled by vite directly",
  );
  assert(isAbsolute(importerPath), "importerPath must be an absolute path");
  assert(
    importerPath.startsWith(config.rootPath + "/"),
    "importerPath must be in the workspace",
  );

  if (specifier.startsWith("npm:")) {
    return {
      type: "npm",
      specifier: specifier.slice(4),
    };
  }

  if (specifier.startsWith("jsr:")) {
    return await resolveJsrPackage(config, specifier.slice(4));
  }

  const packageConfig = config.packages.find((p) =>
    importerPath.startsWith(join(config.rootPath, p.path) + "/")
  );
  if (!packageConfig) {
    throw new Error(`Package not found: ${importerPath}`);
  }

  return await resolveInPackage(config, packageConfig, specifier);
}

export async function loadJsrPackageExports(
  config: ResolverWorkspaceConfig,
  scope: string,
  packageName: string,
  version: string,
): Promise<Record<string, string>> {
  const prefix = `${scope}/${packageName}/${version}`;
  if (jsrPackageCache.has(prefix)) {
    return jsrPackageCache.get(prefix)!;
  }

  const packagePath = join(
    config.rootPath,
    "vendor/jsr.io",
    scope,
    packageName,
    `${version}_meta.json`,
  );
  const json = await Deno.readTextFile(packagePath);
  const exports = JSON.parse(json).exports;
  jsrPackageCache.set(prefix, exports);
  return exports;
}

function resolveJsrPackageVersion(
  config: ResolverWorkspaceConfig,
  scope: string,
  packageName: string,
  specifiedVersion: string,
): string {
  const packageSpecifier = `${scope}/${packageName}@${specifiedVersion}`;
  const directMatch = config.jsrVersions[packageSpecifier];
  if (directMatch) {
    return directMatch;
  }

  for (const [specifier, version] of Object.entries(config.jsrVersions)) {
    if (specifier.startsWith(`${scope}/${packageName}@`)) {
      return version;
    }
  }

  throw new Error(`JSR package not found: ${packageSpecifier}`);
}

export async function resolveJsrPackage(
  config: ResolverWorkspaceConfig,
  specifier: string,
): Promise<ResolveResult> {
  assert(!specifier.startsWith("jsr:"));

  const [scope, packageAndVersion, ...splat] = specifier.split("/");
  const packageName = packageAndVersion.split("@")[0];
  const specifiedVersion = packageAndVersion.split("@")[1] || "*";
  const version = resolveJsrPackageVersion(
    config,
    scope,
    packageName,
    specifiedVersion,
  );

  const exports = await loadJsrPackageExports(
    config,
    scope,
    packageName,
    version,
  );
  const path = [".", ...splat].join("/");
  if (!exports[path]) {
    throw new Error(
      `Export ${path} not found for package ${scope}/${packageName}@${version}.`,
    );
  }

  const filename = exports[path];
  return {
    type: "jsr",
    packageName: `${scope}/${packageName}`,
    version,
    path: join(
      config.rootPath,
      "vendor/jsr.io",
      scope,
      packageName,
      version,
      filename,
    ),
  };
}

export async function resolveInPackage(
  config: ResolverWorkspaceConfig,
  packageConfig: ResolverPackageConfig,
  specifier: string,
): Promise<ResolveResult> {
  let longestMatch = "";

  for (const importKey in packageConfig.imports) {
    if (!specifier.startsWith(importKey)) {
      continue;
    }

    if (importKey.length > longestMatch.length) {
      longestMatch = importKey;
    }
  }

  if (!longestMatch) {
    return resolvePeerPackage(config, specifier);
  }

  const remainder = specifier.slice(longestMatch.length);
  const matchedValue = packageConfig.imports[longestMatch]!;
  const resolvedPath = matchedValue + remainder;

  if (resolvedPath.startsWith(".")) {
    return {
      type: "local",
      path: join(config.rootPath, packageConfig.path, resolvedPath),
    };
  }

  if (resolvedPath.startsWith("jsr:")) {
    return await resolveJsrPackage(config, resolvedPath.slice(4));
  }

  if (resolvedPath.startsWith("npm:")) {
    return {
      type: "npm",
      specifier: dropVersionInPath(resolvedPath.slice(4)),
    };
  }

  throw new Error(`Unknown import mapping: ${longestMatch} -> ${matchedValue}`);
}

export function dropVersionInPath(path: string): string {
  const components = path.split("/");
  const packageNameIndex = components[0].startsWith("@") ? 1 : 0;
  components[packageNameIndex] = components[packageNameIndex].split("@")[0];
  return components.join("/");
}

export function resolvePeerPackage(
  config: ResolverWorkspaceConfig,
  specifier: string,
): ResolveResult {
  let pkg: ResolverPackageConfig | undefined = undefined;
  let path: string = "";

  for (const entry of config.packages) {
    if (!entry.name) {
      continue;
    }

    if (specifier === entry.name) {
      pkg = entry;
      path = ".";
      break;
    }
    if (specifier.startsWith(entry.name + "/")) {
      pkg = entry;
      path = "." + specifier.slice(entry.name.length);
    }
  }

  assert(pkg, `Unknown specifier ${specifier}`);
  const resolvedPath = pkg.exports[path];
  assert(resolvedPath, `Unknown export ${path} for peer package ${pkg.name}.`);

  return {
    type: "peer",
    packageName: pkg.name!,
    path: join(config.rootPath, pkg.path, resolvedPath),
  };
}
