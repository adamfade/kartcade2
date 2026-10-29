// Turns a road (polyline + heights) into a ready-to-install Assetto Corsa track folder and zip.

import type { Rgba } from './dds.ts';
import { zipSync } from 'fflate';
import { buildCenterline, signedArea } from './route.ts';
import { roadProfile } from './elevation.ts';
import type { HeightSampler, Profile } from './elevation.ts';
import { buildGeometry } from './mesh.ts';
import type { MeshPart, TrackGeometry } from './mesh.ts';
import { writeKn5 } from './kn5.ts';
import { MaterialBook, entryFor, macroDetailMaterial, multilayerMaterial, paintMacro, photoMaterial, roadMacro, solidMacro } from './materials.ts';
import type { MaterialLibrary } from './materials.ts';
import { MACRO_M } from './mesh.ts';
import type { MarkingPlan } from './mesh.ts';
import type { Kn5Material, Kn5Texture } from './kn5.ts';
import { buildElements } from './elements.ts';
import { buildTerrain } from './terrain.ts';
import { buildFeatures } from './features.ts';
import { levelBridges, matchRoad } from './roadinfo.ts';
import type { BridgeStructure, RoadInfo } from './roadinfo.ts';
import { buildBridges } from './bridge.ts';
import { buildRoadside } from './roadside.ts';
import { buildRoadSurface } from './roadsurface.ts';
import type { RoadSurfaceStats } from './roadsurface.ts';
import type { RoadsideStats } from './roadside.ts';
import { buildStreets } from './streets.ts';
import type { StreetStats } from './streets.ts';
import type { FeatureStats } from './features.ts';
import { siteHeightSampler } from './site.ts';
import type { SiteRasters } from './site.ts';
import { GROUND_LAYERS, aerialMacro, groundMask, rippleNormals, siteRegions, splitByRegion, splitWater } from './ground.ts';
import type { ElementBuild, TrackElement } from './elements.ts';
import { writeFastLane } from './aiLine.ts';

export const INCLUDE_AI = false;
import { drawPolyline, encodePNG, makeImage } from './png.ts';
import type { LatLon } from './geo.ts';
import type { Centerline } from './route.ts';

export interface BuildInput {
    name: string;
    /** Folder/file id; lowercase letters, digits and underscores. Derived from name if omitted. */
    id?: string;
    polyline: LatLon[];
    heightSampler: HeightSampler;
    width: number;
    city?: string;
    country?: string;
    walls?: boolean;
    flipStart?: boolean;
    /** Circuit: treat the polyline as a closed loop. The first point is the start/finish line. */
    circuit?: boolean;
    /** Drive the route the other way round (start becomes finish; a circuit runs the opposite direction). */
    reverse?: boolean;
    /** Circuit: grid slots and pit boxes (default 12). */
    gridSlots?: number;
    /** Include ai/fast_lane.ai. Defaults to INCLUDE_AI; set true to build a test copy with the AI line. */
    includeAi?: boolean;
    /** Placed scenery (guard rails, trees, signs, banners). */
    elements?: TrackElement[];
    /** Visual terrain around the track from the elevation data (default true). */
    terrain?: boolean;
    /** Photo-scanned material library (from the admin page's library import). Procedural stand-ins if absent. */
    library?: MaterialLibrary;
    /** Road markings (centre line style, edge lines, passing-zone overrides). */
    markings?: MarkingPlan;
    /** Stored site data (1 m lidar + aerial imagery). Without it, `heightSampler` (Terrarium tiles) is used. */
    site?: SiteRasters;
    /** Bridge structure per OSM way id (OSM rarely says; staff pick it in the editor). */
    bridgeStyles?: Record<string, BridgeStructure>;
    /** Use the OSM lanes for width and markings when the site has roads (default true); false keeps `width` throughout. */
    osmLanes?: boolean;
    /** The driver's own photos of landmark facades (never Street View): the wall nearest each point shows it. */
    facadePhotos?: { at: { lat: number; lon: number }; image: Rgba }[];
    /** 'geometry' skips the KN5, AI line, maps and zip (for the editor's preview); default 'full'. */
    output?: 'full' | 'geometry';
    log?: (msg: string) => void;
}

export interface BuildResult {
    id: string;
    files: Record<string, Uint8Array>; // paths relative to the zip root, inside <id>/
    zip: Uint8Array;
    stats: { lengthM: number; climbM: number; descentM: number; maxGradePct: number; widthM: number; minElevM: number; maxElevM: number; triangles: number };
    centerline: Centerline;
    profile: Profile;
    geometry: TrackGeometry;
    /** Scenery meshes, textures and materials (also inside the KN5). */
    elements: ElementBuild;
    /** Visual terrain meshes (also inside the KN5). */
    terrain: MeshPart[];
    /** OpenStreetMap buildings, trees and barriers (also inside the KN5). */
    features: MeshPart[];
    /** Bridge walkways, parapets and structure (also inside the KN5). */
    bridges: MeshPart[];
    /** Side streets, signals, signs, crosswalks, lamps (also inside the KN5). */
    streets: MeshPart[];
    streetStats: StreetStats | null;
    /** Poles, wires, hydrants, mailboxes, parked cars, driveways and kerb ramps (null without OpenStreetMap). */
    roadsideStats?: RoadsideStats | null;
    /** Road patches, sealed cracks, manholes and drains (null on circuits). */
    surfaceStats?: RoadSurfaceStats | null;
    /** What the road is like along its length (lanes, widths, bridges), when the site has OSM roads. */
    road: RoadInfo | null;
    featureStats: FeatureStats;
    /** The base textures and materials (road, grass, wall), for previews. */
    textures: Kn5Texture[];
    materials: Kn5Material[];
}

export function trackId(name: string) {
    const s = name.toLowerCase().normalize('NFKD').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
    return s || 'real_road';
}

const ini = (sections: Record<string, Record<string, string | number>>) =>
    Object.entries(sections).map(([h, kv]) => `[${h}]\n${Object.entries(kv).map(([k, v]) => `${k}=${v}`).join('\n')}\n`).join('\n');

/**
 * The ground materials every track uses. All are ksPerPixelMultiMap_NMDetail over the library (see
 * materials.ts); macro colours start from the photographed material's own mean colour.
 */
function buildSurfaceMaterials(id: string, lib: MaterialLibrary | undefined, circuit: boolean, width: number, lazy = false): MaterialBook {
    const book = new MaterialBook(lazy);
    const roadRole = circuit ? 'asphalt_track' : 'asphalt';
    const road = entryFor(lib, roadRole);
    let rm: ReturnType<typeof roadMacro> | null = null;
    const roadM = () => (rm ??= roadMacro(width, MACRO_M.road, road.mean, { lanes: circuit ? 1 : 2, seed: id.length * 31 + 7 }));
    macroDetailMaterial(book, lib, {
        name: 'road', role: roadRole, specular: 0.2, specularExp: 30, reflection: 0.15,
        macro: { key: `road_macro_${Math.round(width * 10)}_${circuit ? 1 : 2}_${id.length}`, image: () => roadM().image, sizeM: MACRO_M.road },
        maps: { key: `road_maps_${Math.round(width * 10)}_${circuit ? 1 : 2}_${id.length}`, image: () => roadM().maps },
    });
    const gravel = entryFor(lib, 'gravel'), grass = entryFor(lib, 'grass');
    macroDetailMaterial(book, lib, { name: 'sidewalk', role: 'concrete', macro: { key: 'sidewalk_macro', image: () => solidMacro([182, 180, 172], 128, 0.08, 31), sizeM: MACRO_M.shoulder }, specular: 0.1 });
    macroDetailMaterial(book, lib, { name: 'gutter', role: 'concrete', macro: { key: 'gutter_macro', image: () => solidMacro([196, 192, 184], 128, 0.1, 37), sizeM: MACRO_M.shoulder }, specular: 0.1 });
    macroDetailMaterial(book, lib, { name: 'shoulder', role: 'gravel', macro: { key: 'shoulder_macro', image: () => solidMacro(gravel.mean, 128, 0.15, 3), sizeM: MACRO_M.shoulder }, specular: 0.08 });
    macroDetailMaterial(book, lib, { name: 'verge', role: 'grass', macro: { key: 'verge_macro', image: () => solidMacro(grass.mean, 256, 0.18, 5), sizeM: MACRO_M.verge }, specular: 0.04, reflection: 0.02 });
    macroDetailMaterial(book, lib, { name: 'terrain', role: 'grass', macro: { key: 'terrain_macro', image: () => solidMacro(grass.mean.map((c) => c * 0.92) as [number, number, number], 256, 0.25, 9), sizeM: MACRO_M.terrain }, specular: 0.03, reflection: 0.02 });
    macroDetailMaterial(book, lib, { name: 'paint_white', role: roadRole, cutout: !circuit, macro: { key: `paint_white_macro${circuit ? '' : '_worn'}`, image: () => paintMacro([232, 232, 226], 13), sizeM: MACRO_M.paint }, specular: 0.25, reflection: 0.1 });
    macroDetailMaterial(book, lib, { name: 'paint_yellow', role: roadRole, cutout: !circuit, macro: { key: `paint_yellow_macro${circuit ? '' : '_worn'}`, image: () => paintMacro([224, 172, 38], 17), sizeM: MACRO_M.paint }, specular: 0.25, reflection: 0.1 });
    photoMaterial(book, lib, 'wall', 'concrete');
    return book;
}

/** Road markings: the default for the track type, plus any centre-line stretches placed in the editor. */
function markingPlan(input: BuildInput, circuit: boolean): MarkingPlan {
    const base: MarkingPlan = input.markings ?? { centre: circuit ? 'none' : 'double-solid', edges: true };
    const placed = (input.elements ?? []).flatMap((e) => (e.type === 'lines' ? [{ from: e.from, to: e.to, centre: e.centre }] : []));
    return { ...base, overrides: [...(base.overrides ?? []), ...placed] };
}

/** What the Custom Shaders Patch config needs to know about the built track. */
export interface ExtContext {
    /** Aerial ground materials (ksMultilayer, mask R grass, G pavement, B dirt, A forest floor). */
    ground: string[];
    /** A 'water' material is present (rivers, lakes). */
    water?: boolean;
}

/** Custom Shaders Patch config: GrassFX on the grass, RainFX surface classes. Ignored without CSP. */
export function extConfig(ctx: ExtContext = { ground: [] }): string {
    const grass = ['verge', 'terrain', ...ctx.ground].join(', ');
    const lines = [
        '; Custom Shaders Patch settings for this track (generated by the Kartcade track builder).',
        '[GRASS_FX]',
        `GRASS_MATERIALS = ${grass}`,
        'OCCLUDING_MATERIALS = road, shoulder, sidewalk, gutter, paint_white, paint_yellow, bridge_walk',
        'ORIGINAL_GRASS_MATERIALS =',
        '',
    ];
    if (ctx.ground.length) lines.push(
        // Lawns: kept short; forest floor: sparse, untidy; pavement and dirt: none (a threshold no colour reaches).
        '[GRASS_FX_CONFIGURATION_A]', 'SHAPE_SIZE = 0.7', 'SHAPE_TIDY = 0.6', 'SHAPE_CUT = 0.6', '',
        '[GRASS_FX_CONFIGURATION_B]', 'MASK_MAIN_THRESHOLD = 1.0', 'SHAPE_SIZE = 1.6', 'SHAPE_TIDY = 0', '',
        '[GRASS_FX_CONFIGURATION_C]', 'MASK_MAIN_THRESHOLD = 100', 'MASK_MIN_LUMINANCE = 100', '',
        '[GRASS_FX_ADJUSTMENT_AERIAL]', `MATERIALS = ${ctx.ground.join(', ')}`, 'USE_MULTILAYER_MASK = 1', 'MASK_R = A', 'MASK_G = C', 'MASK_B = C', 'MASK_A = B', '',
    );
    if (ctx.water) lines.push('[INCLUDE: common/materials_track.ini]', '', '[Material_Water]', 'Materials = water', 'Type = LAKE', '');
    lines.push(
        '[RAIN_FX]',
        'PUDDLES_MATERIALS = road, road_patch_dark, road_patch_light',
        `SOAKING_MATERIALS = verge, terrain, shoulder${ctx.ground.length ? ', ' + ctx.ground.join(', ') : ''}`,
        'SMOOTH_MATERIALS = paint_white, paint_yellow, sidewalk, bridge_walk, gutter',
        'ROUGH_MATERIALS = shoulder',
        '',
    );
    return lines.join('\n');
}

function surfacesIni() {
    const base = { WAV: '', WAV_PITCH: 0, FF_EFFECT: 'NULL', DIRT_ADDITIVE: 0, IS_PITLANE: 0, BLACK_FLAG_TIME: 0, SIN_HEIGHT: 0, SIN_LENGTH: 0, VIBRATION_GAIN: 0, VIBRATION_LENGTH: 0 };
    return ini({
        SURFACE_0: { KEY: 'ROAD', FRICTION: 0.97, DAMPING: 0, ...base, IS_VALID_TRACK: 1 },
        SURFACE_1: { KEY: 'GRASS', FRICTION: 0.6, DAMPING: 0.1, ...base, WAV: 'grass.wav', WAV_PITCH: 0, DIRT_ADDITIVE: 1, IS_VALID_TRACK: 0, SIN_HEIGHT: 0.03, SIN_LENGTH: 0.5, VIBRATION_GAIN: 1, VIBRATION_LENGTH: 1.5 },
        SURFACE_2: { KEY: 'WALL', FRICTION: 0.3, DAMPING: 0, ...base, IS_VALID_TRACK: 0 },
        SURFACE_3: { KEY: 'GRAVEL', FRICTION: 0.8, DAMPING: 0.02, ...base, WAV: 'gravel.wav', DIRT_ADDITIVE: 0.6, IS_VALID_TRACK: 1, SIN_HEIGHT: 0.01, SIN_LENGTH: 0.3, VIBRATION_GAIN: 0.6, VIBRATION_LENGTH: 0.5 },
    });
}

export function buildTrack(input: BuildInput): BuildResult {
    const log = input.log ?? (() => {});
    const id = input.id ?? trackId(input.name);
    const circuit = !!input.circuit;
    let polyline = input.reverse ? input.polyline.slice().reverse() : input.polyline;
    // Reversing a loop keeps the same start/finish point.
    if (circuit && input.reverse) polyline = [polyline[polyline.length - 1], ...polyline.slice(0, -1)];
    log(circuit ? 'Smoothing the circuit loop' : 'Smoothing the centerline');
    const cl = buildCenterline(polyline, { spacing: circuit ? 1 : 2, closed: circuit });
    const ll = cl.points.map((p) => cl.projection.toLatLon(p));
    log(`Sampling elevation along ${(cl.length / 1000).toFixed(2)} km`);
    const site = input.site;
    const lidar = !!site?.cells.some((c) => c.dem);
    const sampler = site ? siteHeightSampler(site, input.heightSampler) : input.heightSampler;
    if (lidar) log('Using 1 m lidar elevation and aerial imagery');
    // 1 m lidar needs little smoothing; coarse elevation needs more to hide its 10 m cells.
    const sigmaM = lidar ? 6 : circuit ? 12 : 18;
    // The OSM ways the route follows: lane layout, widths and bridges.
    const roads = site?.osm?.roads;
    const road = roads?.length && input.osmLanes !== false && !circuit ? matchRoad(cl, roads, { fallbackWidth: input.width, bridgeStyles: input.bridgeStyles }) : null;
    if (road?.bridges.length) log(`Levelling ${road.bridges.length} bridge${road.bridges.length === 1 ? '' : 's'}: ${road.bridges.map((b) => b.name).join(', ')}`);
    const raw = road?.bridges.length ? levelBridges(ll.map((p) => sampler(p)), cl.s, road.bridges) : undefined;
    const profile = roadProfile(ll, cl.s, sampler, circuit ? { closed: true, loopLength: cl.length, sigmaM } : { sigmaM, raw });
    const ground = (x: number, y: number) => sampler(cl.projection.toLatLon({ x, y }));
    log('Building road, verges and walls');
    const geometry = buildGeometry(cl, profile.heights, {
        width: input.width, walls: input.walls ?? true, ground, flipStart: circuit ? false : input.flipStart,
        gridSlots: input.gridSlots, markings: markingPlan(input, circuit), lidar,
        ...(road ? { widths: road.width, lanes: road.lanes, urban: road.lanes.map((l) => !l.edgeLines), bridges: road.bridges.map((b) => ({ i0: Math.ceil(b.from / cl.spacing), i1: Math.floor(b.to / cl.spacing) })) } : {}),
        ...(circuit ? { verge: 25, maxBankDeg: 2 } : lidar ? { verge: 45 } : {}),
    });
    const pitboxes = geometry.dummies.filter((d) => d.name.startsWith('AC_PIT_')).length;
    const clockwise = circuit && signedArea(cl.points) < 0;

    // With site data the terrain covers the overview square; otherwise the track's box plus a margin.
    let terrainExtent: { x0: number; x1: number; z0: number; z1: number } | undefined;
    if (site?.overview) {
        const a = cl.projection.toLocal({ lat: site.overview.bbox.south, lon: site.overview.bbox.west });
        const b = cl.projection.toLocal({ lat: site.overview.bbox.north, lon: site.overview.bbox.east });
        terrainExtent = { x0: a.x, x1: b.x, z0: a.y, z1: b.y };
    }
    let terrain = input.terrain === false ? [] : buildTerrain(cl, geometry, { ground, extent: terrainExtent });
    if (terrain.length) log('Adding the surrounding terrain');
    const elements = buildElements(cl, geometry, input.elements ?? []);
    if (input.elements?.length) log(`Placed ${input.elements.length} scenery item${input.elements.length === 1 ? '' : 's'}`);
    elements.warnings.forEach((w) => log(w));
    const triangles = [...geometry.parts, ...elements.parts].reduce((a, p) => a + p.indices.length / 3, 0);
    const book = buildSurfaceMaterials(id, input.library, circuit, input.width, input.output === 'geometry');
    // Aerial ground: verge and terrain take the NAIP photo of each 512 m cell (or the overview) as their macro.
    const regions = site ? siteRegions(site) : [];
    const groundMats: string[] = [];
    let hasWater = false;
    if (regions.length) {
        log(`Draping aerial imagery over ${regions.length} area${regions.length === 1 ? '' : 's'}`);
        const tag = (site!.sources.fetched || 'site').replace(/[^0-9a-z]/gi, '').slice(0, 14);
        // The road footprint painted out of the photo depends on the widths along the road.
        let wsig = 0; for (let i = 0; i < cl.points.length; i += 5) wsig = (Math.imul(wsig, 31) + Math.round(geometry.halfAt(i) * 10)) >>> 0;
        // Each region's ground is ksMultilayer: the photo for colour, a mask from classifying it (with near-infrared,
        // lidar and mapped parking / parks) choosing grass, pavement, dirt or forest floor detail.
        const okey = site!.osm ? `o${site!.osm.version ?? 1}` : 'o0';
        const materialOf = (r: (typeof regions)[number]) => {
            const name = multilayerMaterial(book, input.library, {
                name: `aerial_${r.key}`, sizeM: r.sizeM, layers: [...GROUND_LAYERS],
                macro: { key: `aerial_${tag}_${id.length}_${wsig.toString(36)}_${r.key}`, image: () => aerialMacro(r, site!, cl, geometry, 1) },
                mask: { key: `aerialmask_${tag}_${id.length}_${wsig.toString(36)}_${okey}_${r.key}`, image: () => groundMask(r, site!, cl, geometry, Math.min(1024, r.texture), 1) },
            });
            if (!groundMats.includes(name)) groundMats.push(name);
            return name;
        };
        const verge = geometry.parts.filter((p) => p.name.startsWith('1GRASS_'));
        geometry.parts = [...geometry.parts.filter((p) => !p.name.startsWith('1GRASS_')), ...splitByRegion(verge, regions, cl.projection, materialOf)];
        terrain = splitByRegion(terrain, regions, cl.projection, materialOf);
    }
    // Rivers and lakes from OpenStreetMap: their own reflective water mesh (CSP's water shader when present).
    if (site?.osm?.water.length && terrain.length) {
        const water = book.add({
            name: 'water', shader: 'ksPerPixelNM',
            properties: [{ name: 'ksAmbient', a: 0.25 }, { name: 'ksDiffuse', a: 0.25 }, { name: 'ksSpecular', a: 0.9 }, { name: 'ksSpecularEXP', a: 120 }, { name: 'ksEmissive', c: [0, 0, 0] }, { name: 'ksAlphaRef', a: 0 }],
            textures: [
                { sampler: 'txDiffuse', slot: 0, texture: book.image('water_colour.dds', () => ({ width: 8, height: 8, data: new Uint8Array(256).map((_, i) => [44, 60, 58, 255][i % 4]) })) },
                { sampler: 'txNormal', slot: 1, texture: book.image('water_ripples.dds', () => rippleNormals(256), { mips: 'normal' }) },
            ],
        });
        const sp = splitWater(terrain, site.osm.water, cl.projection, water);
        terrain = [...sp.land, ...sp.water];
        if (sp.water.length) { hasWater = true; log('Adding rivers and lakes'); }
    }
    // Bridges: walkways, parapets, deck and structure.
    const bridgeBuild = road?.bridges.length ? buildBridges(cl, geometry, road.bridges, ground, book, input.library) : { parts: [], count: 0 };
    // Side streets and street furniture from OpenStreetMap.
    const streetBuild = road && site?.osm ? buildStreets(cl, geometry, road, site.osm, ground, book, input.library) : null;
    if (streetBuild) {
        const st = streetBuild.stats;
        log(`Adding ${st.stubs} side streets, ${st.signals} signal poles, ${st.stopSigns} stop signs, ${st.crosswalks} crosswalks, ${st.speedSigns} speed signs, ${st.lamps} street lights`);
    }
    // The asphalt itself: real repair patches from the aerial photo, crack sealant, manholes, drains.
    const surface = circuit ? null : buildRoadSurface(cl, geometry, road ?? null, site, book, input.library, { crossS: streetBuild?.crossS, stubs: streetBuild?.stubs, seed: id.length * 13 + 5 });
    if (surface) log(`Adding ${surface.stats.patches} road patches from the aerial photo, ${surface.stats.cracks} sealed cracks, ${surface.stats.manholes} manholes, ${surface.stats.drains} drains`);
    // Surroundings from OpenStreetMap: buildings, woods and trees, mapped barriers.
    let features: MeshPart[] = [];
    let featureStats: FeatureStats = { buildings: 0, trees: 0, barriers: 0 };
    let roadside: MeshPart[] = [];
    let roadsideStats: RoadsideStats | null = null;
    if (site?.osm) {
        const f = buildFeatures(cl, geometry, site.osm, sampler, book, input.library, { site, stubs: streetBuild?.stubs, facadePhotos: input.facadePhotos });
        features = f.parts; featureStats = f.stats;
        log(`Adding ${f.stats.buildings} buildings, ${f.stats.trees} trees and ${f.stats.barriers} barriers from OpenStreetMap`);
        // Utility poles and wires, hydrants, mailboxes, parked cars, driveways, kerb ramps.
        const rs = buildRoadside(cl, geometry, road, site.osm, ground, book, input.library, { site, crossS: streetBuild?.crossS, stubs: streetBuild?.stubs, driveways: f.driveways, fronts: f.fronts });
        roadside = rs.parts; roadsideStats = rs.stats;
        log(`Adding ${rs.stats.poles} utility poles, ${rs.stats.parkedCars + rs.stats.lotCars} parked cars, ${rs.stats.hydrants} hydrants, ${rs.stats.driveways} driveways`);
    }
    const textures = book.textures, materials = book.materials;
    const lengthM = Math.round(cl.length);
    const stats = { lengthM, climbM: Math.round(profile.climb), descentM: Math.round(profile.descent), maxGradePct: Math.round(profile.maxGrade * 1000) / 10, widthM: input.width, minElevM: Math.round(profile.min), maxElevM: Math.round(profile.max), triangles: triangles + features.reduce((a, p) => a + p.indices.length / 3, 0) };
    if (input.output === 'geometry') {
        return { id, files: {}, zip: new Uint8Array(0), centerline: cl, profile, geometry, elements, terrain, features, featureStats, bridges: bridgeBuild.parts, streets: [...(streetBuild?.parts ?? []), ...roadside, ...(surface?.parts ?? [])], streetStats: streetBuild?.stats ?? null, roadsideStats, surfaceStats: surface?.stats ?? null, road, textures, materials, stats };
    }
    log('Writing the KN5 model');
    const kn5 = writeKn5({
        textures: [...textures, ...elements.textures],
        materials: [...materials, ...elements.materials],
        meshes: [...geometry.parts, ...elements.parts, ...terrain, ...features, ...bridgeBuild.parts, ...(streetBuild?.parts ?? []), ...roadside, ...(surface?.parts ?? [])],
        dummies: geometry.dummies,
    });

    log('Writing the AI line');
    const halves = cl.points.map((_, i) => geometry.halfAt(i));
    const aiPts = cl.points.map((p, i) => ({ x: p.x, y: geometry.roadHeightAt(i, 0), z: p.y }));
    const grade = profile.heights.map((h, i) => {
        if (i > 0) return (h - profile.heights[i - 1]) / (cl.s[i] - cl.s[i - 1] || 1);
        return circuit ? (h - profile.heights[profile.heights.length - 1]) / (cl.length - cl.s[cl.s.length - 1] || 1) : 0;
    });
    const ai = writeFastLane(aiPts, { halfWidth: halves, curvature: cl.curvature, grade, closed: circuit });

    log('Drawing the map and previews');
    const xs = cl.points.map((p) => p.x), zs = cl.points.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const margin = 20;
    const extent = Math.max(maxX - minX, maxZ - minZ, 1);
    const scale = Math.max(1, extent / (1024 - 2 * margin)); // metres per pixel
    const mw = Math.ceil((maxX - minX) / scale) + 2 * margin, mh = Math.ceil((maxZ - minZ) / scale) + 2 * margin;
    // AC map: pixel = (world + offset) / scale on both axes (world Z maps straight to image rows),
    // so the car marker lines up with the drawn road.
    const map = makeImage(mw, mh);
    const toMap = (x: number, z: number) => ({ x: (x - minX) / scale + margin, y: (z - minZ) / scale + margin });
    const loopPts = circuit ? [...cl.points, cl.points[0]] : cl.points;
    drawPolyline(map, loopPts.map((p) => toMap(p.x, p.y)), 3, [255, 255, 255, 255]);
    const mapIni = ini({ PARAMETERS: { WIDTH: mw, HEIGHT: mh, MARGIN: margin, SCALE_FACTOR: scale.toFixed(6), X_OFFSET: (-minX + margin * scale).toFixed(3), Z_OFFSET: (-minZ + margin * scale).toFixed(3), DRAWING_SIZE: 10, MAX_SIZE: Math.max(mw, mh) } });

    const thumb = (w: number, h: number, bg: [number, number, number, number], fg: [number, number, number, number], r: number) => {
        const img = makeImage(w, h, bg);
        const pad = 20, s = Math.max((maxX - minX) / (w - 2 * pad), (maxZ - minZ) / (h - 2 * pad), 1e-6);
        const ox = (w - (maxX - minX) / s) / 2, oy = (h - (maxZ - minZ) / s) / 2;
        drawPolyline(img, loopPts.map((p) => ({ x: ox + (p.x - minX) / s, y: h - (oy + (p.y - minZ) / s) })), r, fg);
        return encodePNG(img);
    };

    const uiTrack = {
        name: input.name,
        description: `${input.name}, built from the real ${circuit ? 'circuit' : 'road'}. ${circuit ? `Circuit, ${(cl.length / 1000).toFixed(2)} km lap, ${pitboxes} pit boxes` : `Point to point, ${(cl.length / 1000).toFixed(1)} km, ${Math.round(profile.climb)} m of climb`}. Road${site?.osm ? ', building, woodland and barrier' : ''} data © OpenStreetMap contributors (ODbL); ${lidar ? `elevation USGS 3DEP 1 m lidar${site?.cells.some((c) => c.surface) ? ' and point cloud' : ''}, imagery USDA NAIP (public domain)` : 'elevation from Mapzen/AWS Terrain Tiles (USGS 3DEP, SRTM)'}; materials Poly Haven (CC0). Made for Kartcade.`,
        tags: circuit ? ['circuit', 'real track', 'Oregon', 'Kartcade'] : ['point to point', 'real road', 'Oregon', 'Kartcade'],
        geotags: [input.polyline[0].lat.toFixed(5), input.polyline[0].lon.toFixed(5)],
        country: input.country ?? 'USA',
        city: input.city ?? 'West Linn',
        length: String(lengthM),
        width: String(Math.round(input.width * 10) / 10),
        pitboxes: String(pitboxes),
        run: circuit ? (clockwise ? 'clockwise' : 'counter-clockwise') : 'A to B',
        author: 'Kartcade',
        version: '0.1',
        url: 'https://www.kartcade.com',
        year: new Date().getFullYear(),
    };
    const cameras = ini({
        HEADER: { VERSION: 3, CAMERA_COUNT: 3, SET_NAME: 'TV1' },
        ...Object.fromEntries([0.15, 0.5, 0.85].map((f, k) => {
            const i = Math.round(f * (cl.points.length - 1));
            const r = { x: cl.tangents[i].y, y: -cl.tangents[i].x };
            const pos = [cl.points[i].x + r.x * 15, profile.heights[i] + 6, cl.points[i].y + r.y * 15];
            return [`CAMERA_${k}`, {
                NAME: `Cam ${k + 1}`, POSITION: pos.map((v) => v.toFixed(2)).join(','), FORWARD: `${(-r.x).toFixed(3)},-0.2,${(-r.y).toFixed(3)}`, UP: '0,1,0',
                MIN_FOV: 10, MAX_FOV: 45, IN_POINT: k === 0 ? 0 : [0.15, 0.5, 0.85][k - 1] + 0.175, OUT_POINT: k === 2 ? 1 : [0.15, 0.5, 0.85][k] + 0.175,
                SHADOW_SPLIT0: 50, SHADOW_SPLIT1: 150, SHADOW_SPLIT2: 350, NEAR_PLANE: 1, FAR_PLANE: 5000, MIN_EXPOSURE: 0, MAX_EXPOSURE: 10000, DOF_FACTOR: 10, DOF_RANGE: 10000, DOF_FOCUS: 0, DOF_MANUAL: 0, SPLINE: '', SPLINE_ROTATION: 0, FOV_GAMMA: 0, SPLINE_ANIMATION_LENGTH: 0, IS_FIXED: 0,
            }];
        })),
    });

    const enc = new TextEncoder();
    const files: Record<string, Uint8Array> = {
        [`${id}/${id}.kn5`]: kn5,
        // AI spline left out until its format is confirmed against a file recorded in game (v7 crashed AC on load).
        ...((input.includeAi ?? INCLUDE_AI) ? { [`${id}/ai/fast_lane.ai`]: ai } : {}),
        [`${id}/data/surfaces.ini`]: enc.encode(surfacesIni()),
        [`${id}/extension/ext_config.ini`]: enc.encode(extConfig({ ground: groundMats, water: hasWater })),
        [`${id}/data/cameras.ini`]: enc.encode(cameras),
        [`${id}/data/map.ini`]: enc.encode(mapIni),
        [`${id}/map.png`]: encodePNG(map),
        [`${id}/ui/ui_track.json`]: enc.encode(JSON.stringify(uiTrack, null, 2)),
        [`${id}/ui/outline.png`]: thumb(400, 400, [0, 0, 0, 0], [255, 255, 255, 255], 4),
        [`${id}/ui/preview.png`]: thumb(640, 360, [18, 18, 20, 255], [212, 36, 40, 255], 4),
        [`${id}/README.txt`]: enc.encode(`${input.name}\n\nInstall: unzip so this folder sits in assettocorsa/content/tracks/${id}, then pick the track in Content Manager.\n${circuit ? `Circuit, ${clockwise ? 'clockwise' : 'counter-clockwise'}; the start/finish line is at the first point of the trace.` : 'Point to point: start at the first pins, finish at the last.'} Road data (c) OpenStreetMap contributors (ODbL).\n`),
    };
    log('Packing the zip');
    const zip = zipSync(files, { level: 6 });
    return {
        id, files, zip, centerline: cl, profile, geometry, elements, terrain, features, featureStats, bridges: bridgeBuild.parts, streets: [...(streetBuild?.parts ?? []), ...roadside, ...(surface?.parts ?? [])], streetStats: streetBuild?.stats ?? null, roadsideStats, surfaceStats: surface?.stats ?? null, road, textures, materials, stats,
    };
}
