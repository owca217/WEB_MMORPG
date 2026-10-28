import {
  getExperienceProgress,
  getTotalExperienceForLevel,
  MAX_CHARACTER_LEVEL,
  type CharacterSnapshot
} from "@web-mmorpg/shared";

export function experienceProgressMarkup(character: CharacterSnapshot): string {
  const progress = getExperienceProgress(
    character.level,
    character.experience ?? getTotalExperienceForLevel(character.level)
  );
  const label = character.level >= MAX_CHARACTER_LEVEL
    ? "Maksymalny poziom"
    : `${progress.current} / ${progress.required} XP`;
  return `
    <div class="experience-progress">
      <div class="experience-progress__label"><span>Doświadczenie</span><b data-experience>${label}</b></div>
      <div class="experience-progress__track" role="progressbar" aria-label="Doświadczenie do kolejnego poziomu"
        aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.percentage}" aria-valuetext="${label}">
        <span style="width: ${progress.percentage}%"></span>
      </div>
    </div>
  `;
}
