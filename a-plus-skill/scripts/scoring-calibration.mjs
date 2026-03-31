#!/usr/bin/env node
import { getScoringCalibration } from '../src/application/status/getScoringCalibration.ts';

const jsonMode = process.argv.includes('--json');

function printStats(label, stats) {
  console.log(`${label} min=${stats.min.toFixed(1)} p50=${stats.p50.toFixed(1)} p90=${stats.p90.toFixed(1)} max=${stats.max.toFixed(1)} avg=${stats.avg.toFixed(1)}`);
}

const calibration = await getScoringCalibration();

if (jsonMode) {
  console.log(JSON.stringify(calibration));
} else {
  console.log(
    `scoring_calibration policy=${calibration.summary.policy} source=${calibration.summary.source} degraded=${calibration.summary.degraded} skill_count=${calibration.summary.skill_count} sample_quality=${calibration.summary.sample_quality}`
  );
  if (calibration.summary.sample_quality === 'limited') {
    console.log(`note ${calibration.summary.note}`);
  }
  printStats('fit', calibration.distributions.fit);
  printStats('trend', calibration.distributions.trend);
  printStats('stability', calibration.distributions.stability);
  printStats('security', calibration.distributions.security);
  printStats('final', calibration.distributions.final);
  console.log('decision_counts');
  for (const decision of ['recommend', 'caution', 'hold', 'block']) {
    console.log(`- ${decision}: ${calibration.decision_counts[decision] ?? 0}`);
  }
}
