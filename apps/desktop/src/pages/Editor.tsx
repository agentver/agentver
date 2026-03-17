import { SkillEditor } from '../components/skill-editor'

type EditorPageProps = {
  skillPath?: string | null
  skillName?: string | null
}

export function EditorPage({ skillPath, skillName }: EditorPageProps) {
  return <SkillEditor skillPath={skillPath} skillName={skillName} />
}
