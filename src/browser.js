import PropTypes from 'prop-types'
import React from 'react'
// drag and drop
import HTML5Backend from 'react-dnd-html5-backend'
import { DragDropContext } from 'react-dnd'

// default components (most overridable)
import { DefaultDetail } from './details'
import { DefaultFilter } from './filters'

// default renderers
import { TableHeader } from './headers'
import { TableFile } from './files'
import { TableFolder } from './folders'
import { MultipleConfirmDeletion } from './confirmations'

// default processors
import { GroupByFolder } from './groupers'
import { SortByName } from './sorters'

import { isFolder, foldersFilesSplit, moveFilesAndFolders } from './utils'
import { DefaultAction } from './actions'

import isEqual from 'lodash/isEqual'
import pick from 'lodash/pick'
import union from 'lodash/union'

const SEARCH_RESULTS_PER_PAGE = 20
const regexForNewFolderOrFileSelection = /.*\/__new__[/]?$/gm

function getItemProps(file, browserProps) {
  return {
    key: `file-${file.key}`,
    fileKey: file.key,
    isSelected: (browserProps.selection.includes(file.key)),
    isOpen: file.key in browserProps.openFolders || browserProps.nameFilter,
    isRenaming: browserProps.activeAction === 'rename' && browserProps.actionTargets.includes(file.key),
    isDeleting: browserProps.activeAction === 'delete' && browserProps.actionTargets.includes(file.key),
    isDraft: !!file.draft,
  }
}

class RawFileBrowser extends React.Component {
  static propTypes = {
    files: PropTypes.arrayOf(PropTypes.shape({
      key: PropTypes.string.isRequired,
      modified: PropTypes.any,
      size: PropTypes.number,
    })).isRequired,
    actions: PropTypes.node,
    showActionBar: PropTypes.bool.isRequired,
    canFilter: PropTypes.bool.isRequired,
    showFoldersOnFilter: PropTypes.bool,
    noFilesMessage: PropTypes.string,

    group: PropTypes.func.isRequired,
    sort: PropTypes.func.isRequired,

    localStorageKey: PropTypes.string,

    icons: PropTypes.shape({
      Folder: PropTypes.element,
      FolderOpen: PropTypes.element,
      File: PropTypes.element,
      PDF: PropTypes.element,
      Image: PropTypes.element,
      Delete: PropTypes.element,
      Rename: PropTypes.element,
      Loading: PropTypes.element,
      Download: PropTypes.element,
    }),

    nestChildren: PropTypes.bool.isRequired,
    renderStyle: PropTypes.oneOf([
      'list',
      'table',
    ]).isRequired,

    startOpen: PropTypes.bool.isRequired, // TODO: remove?

    multipleSelection: PropTypes.bool.isRequired,

    headerRenderer: PropTypes.func,
    headerRendererProps: PropTypes.object,
    filterRenderer: PropTypes.func,
    filterRendererProps: PropTypes.object,
    fileRenderer: PropTypes.func,
    fileRendererProps: PropTypes.object,
    folderRenderer: PropTypes.func,
    folderRendererProps: PropTypes.object,
    detailRenderer: PropTypes.func,
    detailRendererProps: PropTypes.object,
    actionRenderer: PropTypes.func,
    actionRendererProps: PropTypes.object,
    confirmDeletionRenderer: PropTypes.func,
    selectMoveTargetRenderer: PropTypes.func,
    selectMoveTargetRendererProps: PropTypes.object,

    onCreateFiles: PropTypes.oneOfType([PropTypes.func, PropTypes.bool]),
    onCreateFolder: PropTypes.oneOfType([PropTypes.func, PropTypes.bool]),
    onMoveFile: PropTypes.oneOfType([PropTypes.func, PropTypes.bool]),
    onMoveFolder: PropTypes.oneOfType([PropTypes.func, PropTypes.bool]),
    onRenameFile: PropTypes.oneOfType([PropTypes.func, PropTypes.bool]),
    onRenameFolder: PropTypes.oneOfType([PropTypes.func, PropTypes.bool]),
    onDeleteFile: PropTypes.oneOfType([PropTypes.func, PropTypes.bool]),
    onDeleteFolder: PropTypes.oneOfType([PropTypes.func, PropTypes.bool]),
    onDownloadFile: PropTypes.oneOfType([PropTypes.func, PropTypes.bool]),
    onDownloadFolder: PropTypes.oneOfType([PropTypes.func, PropTypes.bool]),

    onSelect: PropTypes.func,

    onFolderOpen: PropTypes.func,
    onFolderClose: PropTypes.func,

    onScrolledToBottom: PropTypes.func
  }

  static defaultProps = {
    showActionBar: true,
    canFilter: true,
    showFoldersOnFilter: false,
    noFilesMessage: 'No files.',

    group: GroupByFolder,
    sort: SortByName,

    nestChildren: false,
    renderStyle: 'table',

    startOpen: false,

    multipleSelection: true,

    headerRenderer: TableHeader,
    headerRendererProps: {},
    filterRenderer: DefaultFilter,
    filterRendererProps: {},
    fileRenderer: TableFile,
    fileRendererProps: {},
    folderRenderer: TableFolder,
    folderRendererProps: {},
    detailRenderer: DefaultDetail,
    detailRendererProps: {},
    actionRenderer: DefaultAction,
    actionRendererProps: {},
    confirmDeletionRenderer: MultipleConfirmDeletion,
    selectMoveTargetRenderer: null,
    selectMoveTargetRendererProps: {},

    icons: {},

    onSelect: (files) => { }, // Always called when a file or folder is selected

    onFolderOpen: (folder) => { }, // Folder opened
    onFolderClose: (folder) => { }, // Folder closed
  }

  state = {
    openFolders: {},
    selection: [],
    activeAction: null,
    actionTargets: [],

    nameFilter: '',
    searchResultsShown: SEARCH_RESULTS_PER_PAGE,

    addFolder: null,
  }

  componentDidMount() {
    if (this.props.renderStyle === 'table' && this.props.nestChildren) {
      console.warn('Invalid settings: Cannot nest table children in file browser')
    }

    window.addEventListener('click', this.handleGlobalClick)

    if(this.props.localStorageKey) {
      try {
        const state = JSON.parse(localStorage.getItem(this.props.localStorageKey));
        this.setState(state);
      } catch(e) {
        console.warn(e);
      }
    }
  }

  componentDidUpdate(prevProps, prevState) {
    if(!isEqual(this.state.selection, prevState.selection)) {
      this.props.onSelect(this.state.selection);
    }
    if(this.props.localStorageKey) {
      const remember = pick(this.state, ['openFolders']);
      localStorage.setItem(this.props.localStorageKey, JSON.stringify(remember));
    }
  }

  componentWillUnmount() {
    window.removeEventListener('click', this.handleGlobalClick)
  }

  getFile = (key) => {
    let hasPrefix = false
    const exactFolder = this.props.files.find((f) => {
      if (f.key.startsWith(key)) {
        hasPrefix = true
      }
      return f.key === key
    })
    if (exactFolder) {
      return exactFolder
    }
    if (hasPrefix) {
      return { key, modified: 0, size: 0, relativeKey: key }
    }
  }

  // item manipulation
  createFiles = (files, prefix) => {
    this.setState(prevState => {
      const stateChanges = { selection: [] }
      if (prefix) {
        stateChanges.openFolders = {
          ...prevState.openFolders,
          [prefix]: true,
        }
      }
      return stateChanges
    }, () => {
      this.props.onCreateFiles(files, prefix)
    })
  }

  createFolder = (key) => {
    this.setState({
      activeAction: null,
      actionTargets: [],
      selection: [key],
    }, () => {
      this.props.onCreateFolder(key)
    })
  }

  moveFile = (oldKey, newKey) => {
    this.setState({
      activeAction: null,
      actionTargets: [],
      selection: [newKey],
    }, () => {
      this.props.onMoveFile(oldKey, newKey)
    })
  }

  moveFolder = (oldKey, newKey) => {
    this.setState(prevState => {
      const stateChanges = {
        activeAction: null,
        actionTargets: [],
        selection: [newKey],
      }
      if (oldKey in prevState.openFolders) {
        stateChanges.openFolders = {
          ...prevState.openFolders,
          [newKey]: true,
        }
      }
      return stateChanges
    }, () => {
      this.props.onMoveFolder(oldKey, newKey)
    })
  }

  renameFile = (oldKey, newKey) => {
    this.setState({
      activeAction: null,
      actionTargets: [],
      selection: [newKey],
    }, () => {
      this.props.onRenameFile(oldKey, newKey)
    })
  }

  renameFolder = (oldKey, newKey) => {
    this.setState(prevState => {
      const stateChanges = {
        activeAction: null,
        actionTargets: [],
      }
      if (prevState.selection[0].substr(0, oldKey.length) === oldKey) {
        stateChanges.selection = [prevState.selection[0].replace(oldKey, newKey)]
      }
      if (oldKey in prevState.openFolders) {
        stateChanges.openFolders = {
          ...prevState.openFolders,
          [newKey]: true,
        }
      }
      return stateChanges
    }, () => {
      this.props.onRenameFolder(oldKey, newKey)
    })
  }

  deleteFile = (keys) => {
    this.setState({
      activeAction: null,
      actionTargets: [],
      selection: [],
    }, () => {
      this.props.onDeleteFile(keys)
    })
  }

  deleteFolder = (key) => {
    this.setState(prevState => {
      const stateChanges = {
        activeAction: null,
        actionTargets: [],
        selection: [],
      }
      if (key in prevState.openFolders) {
        stateChanges.openFolders = { ...prevState.openFolders }
        delete stateChanges.openFolders[key]
      }
      return stateChanges
    }, () => {
      this.props.onDeleteFolder(key)
    })
  }

  downloadFile = (keys) => {
    this.setState({
      activeAction: null,
      actionTargets: [],
    }, () => {
      this.props.onDownloadFile(keys)
    })
  }

  downloadFolder = (keys) => {
    this.setState({
      activeAction: null,
      actionTargets: [],
    }, () => {
      this.props.onDownloadFolder(keys)
    })
  }

  // browser manipulation
  beginAction = (action, keys) => {
    this.setState({
      activeAction: action,
      actionTargets: keys || [],
    })
  }

  endAction = () => {
    if (this.state.selection && this.state.selection.length > 0 && (
      this.state.selection.filter((selection) => selection.match(regexForNewFolderOrFileSelection)).length > 0
    )) {
      this.setState({ selection: [] })
    }
    this.beginAction(null, null)
  }

  select = (key, selectedType, ctrlKey, shiftKey, force) => {
    const { actionTargets } = this.state
    const shouldClearState = actionTargets.length && !actionTargets.includes(key)

    let newSelection = [key]
    let newLastSelected = key
    const indexOfKey = this.state.selection.indexOf(key)

    let flip = ctrlKey || (shiftKey && !this.state.lastSelected);
    let range = !flip && shiftKey;

    if (flip && this.props.multipleSelection) {
      if (indexOfKey !== -1) {
        newSelection = [...this.state.selection.slice(0, indexOfKey), ...this.state.selection.slice(indexOfKey + 1)]
        newLastSelected = null
      } else {
        newSelection = [...this.state.selection, key]
      }
    } else if(range && this.props.multipleSelection) {
      const files = this.getVisibleFiles();

      let begin = files.findIndex(file => file.key === this.state.lastSelected)
      let end = files.findIndex(file => file.key === key)
      if(begin > end) {
        [begin, end] = [end, begin];
      }
      const newKeys = files.slice(begin, end + 1).map(file => file.key);
      newSelection = union(this.state.selection, newKeys);
    } else if(!force && indexOfKey !== -1) {
      newSelection = []
      newLastSelected = null
    }

    this.setState(prevState => ({
      selection: newSelection,
      lastSelected: newLastSelected,
      actionTargets: shouldClearState ? [] : actionTargets,
      activeAction: shouldClearState ? null : prevState.activeAction,
    }));
    return newSelection
  }

  setSelection = (selection, lastSelected) => {
    this.setState({
      selection,
      lastSelected,
      actionTargets: [],
      activeAction: null,
    });
  }

  handleShowMoreClick = (event) => {
    event.preventDefault()
    this.setState(prevState => ({
      searchResultsShown: prevState.searchResultsShown + SEARCH_RESULTS_PER_PAGE,
    }))
  }

  toggleFolder = (folderKey) => {
    const isOpen = folderKey in this.state.openFolders
    this.setState(prevState => {
      const stateChanges = {
        openFolders: { ...prevState.openFolders },
      }
      if (isOpen) {
        delete stateChanges.openFolders[folderKey]
      } else {
        stateChanges.openFolders[folderKey] = true
      }
      return stateChanges
    }, () => {
      const callback = isOpen ? 'onFolderClose' : 'onFolderOpen'
      this.props[callback](this.getFile(folderKey))
    })
  }

  openFolder = (folderKey) => {
    this.setState(prevState => ({
      openFolders: {
        ...prevState.openFolders,
        [folderKey]: true,
      },
    }), () => {
      this.props.onFolderOpen(this.getFile(folderKey))
    })
  }

  // event handlers
  handleGlobalClick = (event) => {
    const outside = (!this.browserRef || !this.browserRef.contains(event.target)) 
      && document.getElementById('root').contains(event.target);

    if (outside && (this.state.activeAction == null || this.state.activeAction === 'rename')) {
      this.setState({
        selection: [],
        actionTargets: [],
        activeAction: null,
      })
    }
  }
  handleActionBarRenameClick = (event) => {
    event.preventDefault()
    this.beginAction('rename', this.state.selection)
  }
  handleActionBarDeleteClick = (event) => {
    event.preventDefault()
    this.beginAction('delete', this.state.selection)
  }
  handleActionBarAddFolderClick = (event) => {
    event.preventDefault()
    if (this.state.activeAction === 'createFolder') {
      return
    }
    this.setState(prevState => {
      let addKey = ''
      if (prevState.selection && prevState.selection.length > 0) {
        addKey += prevState.selection
        if (addKey.substr(addKey.length - 1, addKey.length) !== '/') {
          addKey += '/'
        }
      }

      if (addKey !== '__new__/' && !addKey.endsWith('/__new__/')) addKey += '__new__/'
      const stateChanges = {
        actionTargets: [addKey],
        activeAction: 'createFolder',
        selection: [addKey],
      }
      if (prevState.selection && prevState.selection.length > 0) {
        stateChanges.openFolders = prevState.openFolders;
        prevState.selection.forEach(sel => stateChanges.openFolders[sel] = true);
      }
      return stateChanges
    })
  }
  handleActionBarDownloadClick = (event) => {
    event.preventDefault()

    const files = this.getFiles()
    const selectedItems = this.getSelectedItems(files)

    const selectionIsFolder = (selectedItems.length === 1 && isFolder(selectedItems[0]))
    if (selectionIsFolder) {
      this.downloadFolder(this.state.selection)
      return
    }

    this.downloadFile(this.state.selection)
  }
  handleActionBarMoveClick = (event) => {
    event.preventDefault()
    this.beginAction('move', this.state.selection)
  }

  updateFilter = (newValue) => {
    this.setState({
      nameFilter: newValue,
      searchResultsShown: SEARCH_RESULTS_PER_PAGE,
    })
  }

  updateBrowserProps() {
    if(this.browserProps === undefined) {
      this.browserProps = {};
    }
    Object.assign(this.browserProps, {
      // browser config
      nestChildren: this.props.nestChildren,
      fileRenderer: this.props.fileRenderer,
      fileRendererProps: this.props.fileRendererProps,
      folderRenderer: this.props.folderRenderer,
      folderRendererProps: this.props.folderRendererProps,
      confirmDeletionRenderer: this.props.confirmDeletionRenderer,
      confirmMultipleDeletionRenderer: this.props.confirmMultipleDeletionRenderer,
      icons: this.props.icons,
      multipleSelection: this.props.multipleSelection,
      files: this.props.files,
      visibleFiles: this.getVisibleFiles(),

      // browser state
      openFolders: this.state.openFolders,
      nameFilter: this.state.nameFilter,
      selection: this.state.selection,
      activeAction: this.state.activeAction,
      actionTargets: this.state.actionTargets,

      // browser manipulation
      select: this.select,
      setSelection: this.setSelection,
      openFolder: this.openFolder,
      toggleFolder: this.toggleFolder,
      beginAction: this.beginAction,
      endAction: this.endAction,

      // item manipulation
      createFiles: this.props.onCreateFiles ? this.createFiles : undefined,
      createFolder: this.props.onCreateFolder ? this.createFolder : undefined,
      renameFile: this.props.onRenameFile ? this.renameFile : undefined,
      renameFolder: this.props.onRenameFolder ? this.renameFolder : undefined,
      moveFile: this.props.onMoveFile ? this.moveFile : undefined,
      moveFolder: this.props.onMoveFolder ? this.moveFolder : undefined,
      deleteFile: this.props.onDeleteFile ? this.deleteFile : undefined,
      deleteFolder: this.props.onDeleteFolder ? this.deleteFolder : undefined,

      // rendering
      renderActions: this.renderActions,

      getItemProps: getItemProps,
    });
  }

  getBrowserProps() {
    if(!this.browserProps) {
      this.updateBrowserProps();
    }
    return this.browserProps;
  }

  renderActions = (selectedItems, props = {}) => {
    const {
      icons,
      actionRenderer: ActionRenderer,
      onCreateFolder, onRenameFile, onRenameFolder,
      onDeleteFile, onDeleteFolder, onDownloadFile,
      onDownloadFolder, selectMoveTargetRenderer
    } = this.props
    const browserProps = this.getBrowserProps()

    const selectionIsFolder = (selectedItems.length === 1 && isFolder(selectedItems[0]))

    return (
      <ActionRenderer
        browserProps={browserProps}

        selectedItems={selectedItems}
        isFolder={selectionIsFolder}

        icons={icons}
        nameFilter={this.state.nameFilter}

        canCreateFolder={typeof onCreateFolder === 'function'}
        onCreateFolder={this.handleActionBarAddFolderClick}

        canRenameFile={typeof onRenameFile === 'function'}
        onRenameFile={this.handleActionBarRenameClick}

        canRenameFolder={typeof onRenameFolder === 'function'}
        onRenameFolder={this.handleActionBarRenameClick}

        canDeleteFile={typeof onDeleteFile === 'function'}
        onDeleteFile={this.handleActionBarDeleteClick}

        canDeleteFolder={typeof onDeleteFolder === 'function'}
        onDeleteFolder={this.handleActionBarDeleteClick}

        canDownloadFile={typeof onDownloadFile === 'function'}
        onDownloadFile={this.handleActionBarDownloadClick}

        canDownloadFolder={typeof onDownloadFolder === 'function'}
        onDownloadFolder={this.handleActionBarDownloadClick}

        canMove={typeof selectMoveTargetRenderer === 'function'}
        onMove={this.handleActionBarMoveClick}

        {...this.props.actionRendererProps}
        {...props}
      />
    )
  }

  renderActionBar(selectedItems) {
    const {
      canFilter, filterRendererProps, filterRenderer: FilterRenderer,
    } = this.props
    let filter
    if (canFilter) {
      filter = (
        <FilterRenderer
          value={this.state.nameFilter}
          updateFilter={this.updateFilter}
          {...filterRendererProps}
        />
      )
    }

    const actions = this.renderActions(selectedItems)

    return (
      <div className="action-bar">
        {filter}
        {actions}
      </div>
    )
  }

  renderFiles(files, depth) {
    const {
      fileRenderer: FileRenderer, fileRendererProps,
      folderRenderer: FolderRenderer, folderRendererProps,
    } = this.props
    const browserProps = this.getBrowserProps()
    let renderedFiles = []

    files.map((file) => {
      const thisItemProps = {
        ...browserProps.getItemProps(file, browserProps),
        depth: this.state.nameFilter ? 0 : depth,
      }

      if (!isFolder(file)) {
        renderedFiles.push(
          <FileRenderer
            {...file}
            {...thisItemProps}
            browserProps={browserProps}
            {...fileRendererProps}
          />
        )
      } else {
        if (this.props.showFoldersOnFilter || !this.state.nameFilter) {
          renderedFiles.push(
            <FolderRenderer
              {...file}
              {...thisItemProps}
              browserProps={browserProps}
              {...folderRendererProps}
            />
          )
        }
        if (this.state.nameFilter || (thisItemProps.isOpen && !browserProps.nestChildren)) {
          renderedFiles = renderedFiles.concat(this.renderFiles(file.children, depth + 1))
        }
      }
    })
    return renderedFiles
  }

  handleMultipleDeleteSubmit = () => {
    const [folders, files] = foldersFilesSplit(this.state.selection)
    this.deleteFile(files)
    this.deleteFolder(folders)
  }

  handleMoveTargetSelect = (target) => {
    const [folders, files] = foldersFilesSplit(this.state.actionTargets)
    moveFilesAndFolders({
      browserProps: this.getBrowserProps(),
      files, folders, target
    })
    this.endAction()
  }

  handleFilesScroll = (e) => {
    const el = e.target;
    if(typeof(this.props.onScrolledToBottom) === 'function'
       && el.scrollHeight - el.scrollTop === el.clientHeight) {
      this.props.onScrolledToBottom(e);
    }
  }

  getFiles() {
    let files = this.props.files.concat([])
    if (this.state.activeAction === 'createFolder') {
      files.push({
        key: this.state.actionTargets[0],
        size: 0,
        draft: true,
      })
    }
    if (this.state.nameFilter) {
      const filteredFiles = []
      const terms = this.state.nameFilter.toLowerCase().split(' ')
      files.map((file) => {
        let skip = false
        terms.map((term) => {
          if (file.key.toLowerCase().trim().indexOf(term) === -1) {
            skip = true
          }
        })
        if (skip) {
          return
        }
        filteredFiles.push(file)
      })
      files = filteredFiles
    }
    if (typeof this.props.group === 'function') {
      files = this.props.group(files, '')
    } else {
      const newFiles = []
      files.map((file) => {
        if (!isFolder(file)) {
          newFiles.push(file)
        }
      })
      files = newFiles
    }
    if (typeof this.props.sort === 'function') {
      files = this.props.sort(files)
    }
    return files
  }

  flattenFiles(files, result) {
    for(let f of files) {
      if(isFolder(f)) {
        if(this.props.showFoldersOnFilter || !this.state.nameFilter) {
          result.push(f);
        }
        if(this.state.nameFilter || 
          (f.key in this.state.openFolders && !this.props.nestChildren)) {
            this.flattenFiles(f.children, result);
        }
      } else {
        result.push(f);
      }      
    }
  }

  getVisibleFiles() {
    const result = [];
    this.flattenFiles(this.getFiles(), result);
    return result;
  }

  getSelectedItems(files) {
    const { selection } = this.state
    const selectedItems = []
    const findSelected = (item) => {
      if (selection.includes(item.key)) {
        selectedItems.push(item)
      }
      if (item.children) {
        item.children.map(findSelected)
      }
    }
    files.map(findSelected)
    return selectedItems
  }

  render() {
    this.updateBrowserProps();
    const browserProps = this.getBrowserProps()
    const headerProps = {
      browserProps,
      fileKey: '',
      fileCount: browserProps.visibleFiles.length,
      selectedCount: this.state.selection.length
    }
    let renderedFiles

    const files = this.getFiles()
    const selectedItems = this.getSelectedItems(files)

    let header
    /** @type any */
    let contents = this.renderFiles(files, 0)
    switch (this.props.renderStyle) {
      case 'table':
        if (!contents.length) {
          if (this.state.nameFilter) {
            contents = (
              <tr>
                <td colSpan={100}>
                  No files matching "{this.state.nameFilter}".
                </td>
              </tr>
            )
          } else {
            contents = (
              <tr>
                <td colSpan={100}>
                  {this.props.noFilesMessage}
                </td>
              </tr>
            )
          }
        } else {
          if (this.state.nameFilter) {
            const numFiles = contents.length
            contents = contents.slice(0, this.state.searchResultsShown)
            if (numFiles > contents.length) {
              contents.push(
                <tr key="show-more">
                  <td colSpan={100}>
                    <a
                      onClick={this.handleShowMoreClick}
                      href="#"
                    >
                      Show more results
                    </a>
                  </td>
                </tr>
              )
            }
          }
        }

        if (this.props.headerRenderer) {
          header = (
            <thead>
              <this.props.headerRenderer
                {...headerProps}
                {...this.props.headerRendererProps}
              />
            </thead>
          )
        }

        renderedFiles = (
          <table cellSpacing="0" cellPadding="0">
            {header}
            <tbody>
              {contents}
            </tbody>
          </table>
        )
        break

      case 'list':
        if (!contents.length) {
          if (this.state.nameFilter) {
            contents = (<p className="empty">No files matching "{this.state.nameFilter}"</p>)
          } else {
            contents = (<p className="empty">No files.</p>)
          }
        } else {
          let more
          if (this.state.nameFilter) {
            const numFiles = contents.length
            contents = contents.slice(0, this.state.searchResultsShown)
            if (numFiles > contents.length) {
              more = (
                <a
                  onClick={this.handleShowMoreClick}
                  href="#"
                >
                  Show more results
                </a>
              )
            }
          }
          contents = (
            <div>
              <ul>{contents}</ul>
              {more}
            </div>
          )
        }

        if (this.props.headerRenderer) {
          header = (
            <this.props.headerRenderer
              {...headerProps}
              {...this.props.headerRendererProps}
            />
          )
        }

        renderedFiles = (
          <div>
            {header}
            {contents}
          </div>
        )
        break
    }

    const ConfirmDeletionRenderer = this.props.confirmDeletionRenderer
    const SelectMoveTargetRenderer = this.props.selectMoveTargetRenderer

    const previewFileKey = this.state.selection[this.state.selection.length-1];

    return (
      <>
        <div className="rendered-react-keyed-file-browser" ref={el => { this.browserRef = el }}>
          {this.props.actions}
          <div className="rendered-file-browser">
            {this.props.showActionBar && this.renderActionBar(selectedItems)}
            {this.state.activeAction === 'delete' &&
              <ConfirmDeletionRenderer
                handleDeleteSubmit={this.handleMultipleDeleteSubmit}
                onCancel={this.endAction}
                items={this.state.selection}
              />}
            {this.state.activeAction === 'move' &&
              <SelectMoveTargetRenderer
                targets={this.state.actionTargets}
                onCancel={this.endAction}
                onSelect={this.handleMoveTargetSelect}
                {...this.props.selectMoveTargetRendererProps}
              />}
            <div className="files" onScroll={this.handleFilesScroll}>
              {renderedFiles}
            </div>
          </div>
          {this.props.detailRenderer && <this.props.detailRenderer
            fileKey={previewFileKey}
            {...this.props.detailRendererProps}
          />}
        </div>
      </>
    )
  }
}

@DragDropContext(HTML5Backend)
class FileBrowser extends RawFileBrowser { }

export default FileBrowser
export { RawFileBrowser }
