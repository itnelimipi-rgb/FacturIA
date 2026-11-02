export type WorkspaceSection = 'home' | 'movements' | 'documents' | 'help';
export type MovementFilter = 'all' | 'pending' | 'conciliado';
export const workspaceSectionTargets: Record<WorkspaceSection, string> = {
  home: 'workspace-home', movements: 'workspace-movements-page',
  documents: 'workspace-documents-page', help: 'workspace-help',
};
export type WorkspaceNavigation = {
  section: WorkspaceSection;
  focusTarget: string;
  request: number;
  reviewRequest?: {filter: MovementFilter; request: number};
};
export const INITIAL_WORKSPACE_NAVIGATION: WorkspaceNavigation = {
  section: 'home', focusTarget: workspaceSectionTargets.home, request: 0,
};
type NavigationAction =
  | {type: 'section'; section: WorkspaceSection}
  | {type: 'records'; section: 'movements' | 'documents'; filter?: MovementFilter}
  | {type: 'reset'};

export function workspaceNavigationReducer(state: WorkspaceNavigation, action: NavigationAction): WorkspaceNavigation {
  const request = state.request + 1;
  if (action.type === 'reset') return {...INITIAL_WORKSPACE_NAVIGATION, request};
  if (action.type === 'section') return {...state, section: action.section, focusTarget: workspaceSectionTargets[action.section], request};
  return {
    ...state, section: action.section, request,
    focusTarget: action.section === 'movements' ? 'workspace-movements' : 'workspace-documents',
    reviewRequest: action.section === 'movements' ? {filter: action.filter ?? 'all', request} : state.reviewRequest,
  };
}
