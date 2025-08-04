#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <unistd.h>
#include <dirent.h>
#include <errno.h>

int main(void)
{
    char cwd[4096];
    if (getcwd(cwd, 4096) < 0) {
        perror("getcwd");
        return 1;
    }
    printf("initial cwd is: %s\n", cwd);

    char* ref = getenv("PWD");
    if (ref != NULL && strcmp(cwd, "/") == 0) {
      printf("Found PWD from env; changing wd to: %s\n", ref);
      /*if (chdir(ref) < 0) {
        perror("chdir");
        return 1;
      }*/
    }

    // char buf[1024];
    // while (scanf("%1023s", buf) > 0) {
    //   printf("your input is [%s]\n", buf);
    // }

    for (__wasi_fd_t fd = 3; fd != 0; fd++) {
      __wasi_prestat_t prestat;
      __wasi_errno_t ret = __wasi_fd_prestat_get(fd, &prestat);

      printf("probing preopen fd=%d (ret=%d)...\n", fd, ret);

      if (ret == __WASI_ERRNO_BADF) break;
      if (ret != __WASI_ERRNO_SUCCESS) {
        printf("__wasi_fd_prestat_get: %d\n", ret);
        exit(1);
      }

      if (prestat.tag != __WASI_PREOPENTYPE_DIR) {
        continue;
      }

      size_t namelen = prestat.u.dir.pr_name_len;
      char buf[namelen + 1];
      ret = __wasi_fd_prestat_dir_name(fd, (uint8_t*) buf, prestat.u.dir.pr_name_len);
      if (ret == __WASI_ERRNO_BADF) break;
      if (ret != __WASI_ERRNO_SUCCESS) {
        printf("__wasi_fd_prestat_dir_name: %d\n", ret);
        exit(1);
      }
      buf[namelen] = '\0';

      printf("preopen fd=%d: %s\n", fd, buf);
    }

    char* resolved = realpath("/home/qbane/agda-stdlib-2.0/LICENCE", NULL);
    if (resolved == NULL) {
      perror("realpath");
      return 1;
    }
    printf("realpath -> %s\n", resolved);
    free(resolved);

    struct dirent *entry;
    DIR *dp;

    // Open the current directory
    dp = opendir("/");
    if (dp == NULL) {
        perror("opendir(\".\")");
        return 1;
    }

    printf("Contents of the current directory:\n");

    // Read and print directory entries
    while ((entry = readdir(dp)) != NULL) {
        printf("%s\n", entry->d_name);
    }

    // Close the directory
    closedir(dp);

    puts("--- end ---");

    return 0;
}
