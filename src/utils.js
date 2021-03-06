import partition from 'lodash/partition'

function isFolder(file) {
  return file.key.endsWith('/')
}

function foldersFilesSplit(items) {
  return partition(items, item => item.endsWith('/'));
}

function moveFilesAndFolders({ browserProps, folders, files, target }) {
  browserProps.openFolder(target)

  const moves = [];

  function filterPred(file) {
    //returns false if there is a selected folder containing the file
    return !folders.some(folder => folder != file && file.startsWith(folder));
  }

  files = files.filter(filterPred);
  folders = folders.filter(filterPred);

  for(let selection of files) {
    const fileKey = selection
    const fileNameParts = fileKey.split('/')
    const fileName = fileNameParts[fileNameParts.length - 1]
    const newKey = `${target}${fileName}`
    if (newKey !== fileKey && browserProps.moveFile) {
      browserProps.moveFile(fileKey, newKey)
    }
  }

  for(let selection of folders) {
    const fileKey = selection
    const fileNameParts = fileKey.split('/')
    const folderName = fileNameParts[fileNameParts.length - 2]

    const newKey = `${target}${folderName}/`
    // abort if the new folder name contains itself
    if (newKey.substr(0, fileKey.length) === fileKey) return

    if (newKey !== fileKey && browserProps.moveFolder) {
      browserProps.moveFolder(fileKey, newKey)
    }
  }
}

function moveFilesAndFoldersDrop(props, monitor, component) {
  if (!monitor.didDrop()) {
    return
  }

  const dropResult = monitor.getDropResult()
  const [folders, files] = foldersFilesSplit(props.browserProps.selection)

  moveFilesAndFolders({ browserProps: props.browserProps, folders, files, target: dropResult.path });
}

export { isFolder, foldersFilesSplit, moveFilesAndFolders, moveFilesAndFoldersDrop }
