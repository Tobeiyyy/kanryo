import type { Task } from "../../shared/types";

export default function TaskDetail({ task, onClose }: { task: Task; subtasks: Task[]; onClose: () => void }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}><h2>{task.title}</h2></div>
    </div>
  );
}
