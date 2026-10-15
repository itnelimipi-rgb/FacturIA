import type {ReconciliationStatus} from './types';

export type WorkspaceSection = 'home' | 'movements' | 'documents' | 'help';
type MovementFilter = 'all' | ReconciliationStatus;
export type UploadSection = 'document-upload' | 'bank-upload';
export const workspaceSectionTargets: Record<WorkspaceSection, string> = {
  home: 'workspace-home', movements: 'workspace-movements-page',
  documents: 'workspace-documents-page', help: 'workspace-help',
};
export type WorkspaceNavigation = {
  section: WorkspaceSection;
  focusTarget: string;
  request: number;
  reviewRequest?: {filter: MovementFilter; request: number};
  uploadTargetId: string | null;
};
export const INITIAL_WORKSPACE_NAVIGATION: WorkspaceNavigation = {
  section: 'home', focusTarget: workspaceSectionTargets.home, request: 0, uploadTargetId: null,
};
type NavigationAction =
  | {type: 'section'; section: WorkspaceSection}
  | {type: 'records'; section: 'movements' | 'documents'; filter?: MovementFilter}
  | {type: 'upload'; kind: UploadSection; movementId?: string}
  | {type: 'clear-upload-context'}
  | {type: 'reset'};

export function workspaceNavigationReducer(state: WorkspaceNavigation, action: NavigationAction): WorkspaceNavigation {
  if (action.type === 'clear-upload-context') return {...state, uploadTargetId: null};
  const request = state.request + 1;
  if (action.type === 'reset') return {...INITIAL_WORKSPACE_NAVIGATION, request};
  if (action.type === 'section') return {...state, section: action.section, focusTarget: workspaceSectionTargets[action.section], request};
  if (action.type === 'upload') return {
    ...state, section: action.kind === 'document-upload' ? 'documents' : 'movements',
    focusTarget: action.kind, request,
    uploadTargetId: action.kind === 'document-upload' ? action.movementId ?? null : state.uploadTargetId,
  };
  return {
    ...state, section: action.section, request,
    focusTarget: action.section === 'movements' ? 'workspace-movements' : 'workspace-documents',
    reviewRequest: action.section === 'movements' ? {filter: action.filter ?? 'all', request} : state.reviewRequest,
  };
}
