#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <unistd.h>
#include <dirent.h>

int main(void)
{
    char cwd[4096];
    if (getcwd(cwd, 4096) < 0) {
        perror("getcwd");
        return 1;
    }
    printf("initial cwd is: %s\n", cwd);

    // vscode WASI does not follow this convention?
    char* ref = getenv("PWD");
    if (ref != NULL && strcmp(cwd, "/") == 0) {
      printf("changing wd to: %s\n", ref);
      if (chdir(ref) < 0) {
        perror("chdir");
        return 1;
      }
    }

    char buf[1024];
    while (scanf("%1023s", buf) > 0) {
      printf("your input is [%s]\n", buf);
    }

    struct dirent *entry;
    DIR *dp;

    // Open the current directory
    dp = opendir(".");
    if (dp == NULL) {
        perror("opendir");
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
