import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// The existing browser project has no package.json; load standalone ES modules
// through data URLs so Node can run tests without changing project configuration.
async function browserModule(relativePath) {
    const code = await readFile(new URL(relativePath, import.meta.url), 'utf8');
    return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

const match = await browserModule('../match_policy_v4_7.js');
const runtime = await browserModule('../runtime_policy_v5_1.js');

function composition(delta, extra = {}) {
    return { composition: {
        currentLeft: delta, currentRight: 100 + delta,
        currentTop: delta, currentBottom: 100 + delta,
        targetLeft: 0, targetRight: 100,
        targetTop: 0, targetBottom: 100,
        toleranceX: 10, toleranceY: 10, ...extra
    }};
}

function pose(error, extra = {}) {
    const errors = Object.fromEntries([
        'leftElbow', 'rightElbow', 'leftHip', 'rightHip',
        'leftKnee', 'rightKnee', 'leftUpperArm', 'leftForearm',
        'rightUpperArm', 'rightForearm', 'leftThigh', 'leftLowerLeg',
        'rightThigh', 'rightLowerLeg'
    ].map(key => [key, error]));
    return { pose: { errors, ...extra } };
}

test('composition: missing/invalid inputs retain unknown contract', () => {
    assert.deepEqual(match.evaluateCompositionSnapshot(null), {
        level: 'unknown', status: '분석 불가', hardMatched: false,
        fairMatched: false, maxRatio: null, ratios: null
    });
    assert.equal(match.evaluateCompositionSnapshot(composition(0, {toleranceX: 0})).level, 'unknown');
});

test('composition: hard/fair/bad and explicit snapshot precedence', () => {
    assert.equal(match.evaluateCompositionSnapshot(composition(5)).level, 'good');
    assert.equal(match.evaluateCompositionSnapshot(composition(14)).level, 'fair');
    assert.equal(match.evaluateCompositionSnapshot(composition(20)).level, 'bad');
    assert.equal(match.evaluateCompositionSnapshot({...composition(14), compositionMatched: true}).level, 'good');
    assert.equal(match.evaluateCompositionSnapshot(composition(14, {valid:false})).level, 'unknown');
});

test('pose: missing and incomplete inputs remain unknown', () => {
    assert.deepEqual(match.evaluatePoseSnapshot(undefined), {
        level: 'unknown', status: '분석 불가', hardMatched: false,
        fairMatched: false, maxRatio: null, parts: []
    });
    assert.equal(match.evaluatePoseSnapshot({pose:{}}).level, 'unknown');
});

test('pose: hard/fair/bad match boundaries and capture flag', () => {
    assert.equal(match.evaluatePoseSnapshot(pose(5)).level, 'good');
    assert.equal(match.evaluatePoseSnapshot(pose(14)).level, 'fair');
    assert.equal(match.evaluatePoseSnapshot(pose(20)).level, 'bad');
    assert.equal(match.evaluatePoseSnapshot({...pose(20), poseMatched: true}).level, 'good');
});

test('runtime: library pauses inference and releases camera', () => {
    const state = runtime.deriveRuntimePolicy({state:runtime.RUNTIME_STATES.REFERENCE_LIBRARY,streamLive:true,hasReference:true,inferenceActive:true});
    assert.equal(state.cameraOn,false);
    assert.equal(state.poseOn,false);
    assert.equal(state.shouldPauseInference,true);
    assert.equal(state.shouldReleaseCamera,true);
});

test('runtime: countdown allows auto capture only when eligible', () => {
    const eligible = {state:runtime.RUNTIME_STATES.CAPTURE_COUNTDOWN,streamLive:true,hasReference:true,
        inferenceActive:true,autoShootArmed:true};
    assert.equal(runtime.deriveRuntimePolicy(eligible).autoCaptureAllowed,true);
    assert.equal(runtime.deriveRuntimePolicy({...eligible,reviewLocked:true}).autoCaptureAllowed,false);
    assert.equal(runtime.deriveRuntimePolicy({...eligible,captureLocked:true}).poseOn,false);
});

test('runtime: review can act but should not infer', () => {
    const state = runtime.deriveRuntimePolicy({state:runtime.RUNTIME_STATES.REVIEW,streamLive:true,hasReference:true});
    assert.equal(state.canReviewAction,true);
    assert.equal(state.poseOn,false);
    assert.equal(state.shouldPauseInference,true);
});
